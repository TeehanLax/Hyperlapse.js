/*
   Hyperlapse - Teehan+Lax Labs 2013 - Peter Nitsch

   Dependancies:
      Three.js
      GSVPano.js
      Tween.js
      maps.googleapis.com/maps/api/js?v=3.exp
*/

Number.prototype.toRad = function() {
   return this * Math.PI / 180;
}

Number.prototype.toDeg = function() {
   return this * 180 / Math.PI;
}

var pointOnLine = function(t, a, b) {
   var lat1 = a.lat().toRad(), lon1 = a.lng().toRad();
   var lat2 = b.lat().toRad(), lon2 = b.lng().toRad();

   x = lat1 + t * (lat2 - lat1);
   y = lon1 + t * (lon2 - lon1);

   return new google.maps.LatLng(x.toDeg(), y.toDeg());
};

var Hyperlapse = function(container, map, params) {

   /* private */

   var getElevation = function(locations, callback) {
      var positionalRequest = {
         locations: locations
      }

     _elevator.getElevationForLocations(positionalRequest, function(results, status) {
         if (status == google.maps.ElevationStatus.OK) {
            callback(results);
         } else {
            callback(null);
         }
      });
   };

   var handleDirectionsRoute = function(response) {
      if(!_is_running) {
         self.reset();

         var path = response.routes[0].overview_path;

         for(var i=0; i<path.length; i++) {

            if(i+1 < path.length-1) {
               var d = google.maps.geometry.spherical.computeDistanceBetween(path[i], path[i+1]);

               if(d > _d) {
                  var total_segments = Math.floor(d/_d)

                  for(var j=0; j<total_segments; j++) {
                     var t = j/total_segments;
                     var way = pointOnLine(t, path[i], path[i+1]);
                     _points.push(way);
                  }
               } else {
                  _points.push(path[i]);
               }
               
            } else {
               _points.push(path[i]);
            }
         }

         _loader.load( _points[_point_index] );

      } else {
         self.pause();
         handleDirectionsRoute(response);
      } 
   }; 

   var self = this,
      _listeners = [],
      _container = container,
      _map = map,
      _params = params || {},
      _w = _params.width || 800,
      _h = _params.height || 400,
      _d = _params.distance || 20,
      _fov = _params.fov || 70,
      _zoom = _params.zoom || 1,
      _millis = _params.interval || 50,
      _directions_service,
      _elevator,
      _lat = 0, _lon = 0,
      _position_x = 0, _position_y = 0,
      _is_running = false,
      _point_index = 0, 
      _origin_heading = 0, _origin_pitch = 0,
      _forward = true,
      _lookat_heading = 0, _lookat_elevation = 0,
      _interval = null,
      _canvas, _context,
      _camera, _scene, _renderer, _mesh,
      _loader,
      _points = [], _headings = [], _pitchs = [], _mats = [], _elevations = [];

   _directions_service = new google.maps.DirectionsService();
   _elevator = new google.maps.ElevationService();

   _canvas = document.createElement( 'canvas' );
   _context = _canvas.getContext( '2d' );

   _camera = new THREE.PerspectiveCamera( _fov, _w/_h, 1, 1100 );
   _camera.target = new THREE.Vector3( 0, 0, 0 );

   _scene = new THREE.Scene();
   _scene.add( _camera );

   try {
      var isWebGL = !!window.WebGLRenderingContext && !!document.createElement('canvas').getContext('experimental-webgl');
   }catch(e){
      console.log(e);
   }

   _renderer = new THREE.WebGLRenderer();
   _renderer.autoClearColor = false;
   _renderer.setSize( _w, _h );

   _mesh = new THREE.Mesh( new THREE.SphereGeometry( 500, 60, 40 ), new THREE.MeshBasicMaterial( { map: THREE.ImageUtils.loadTexture( 'blank.jpg' ) } ) );
   _mesh.doubleSided = true;
   _scene.add( _mesh );
   
   _container.appendChild( _renderer.domElement );

   _loader = new GSVPANO.PanoLoader( {zoom: _zoom} );
   _loader.onPanoramaLoad = function() {
      var canvas = document.createElement("canvas");
      var context = canvas.getContext('2d');
      canvas.setAttribute('width',this.canvas.width);
      canvas.setAttribute('height',this.canvas.height);
      context.drawImage(this.canvas, 0, 0);
      var mat = new THREE.Texture( canvas );

      _headings.push(this.rotation);
      _pitchs.push(this.pitch);
      _mats.push(mat);
      _elevations.push(_points[_point_index]);

      if(++_point_index != _points.length) {
         self.broadcastMessage('onLoadProgress',{position:_point_index});
         _loader.load( _points[_point_index] );
      } else {
         self.broadcastMessage('onLoadComplete',{});
         _point_index = 0;

         getElevation(_elevations, function(results){
            _elevations = results;

            self.animate();  
            self.play();
         });
      }
   };


   /* public */

   this.start = _params.start || null;
   this.end = _params.end || null;
   this.lookat = _params.lookat || null;
   this.elevation_offset = 0;
   this.tilt = 0;

   this.isRunning = function() { return _is_running; };
   this.length = function() { return _points.length; };
   this.setPitch = function(val) { _position_y = val };

   this.addListener = function(o){
      self.removeListener (o);
      return _listeners.push(o);
   };

   this.removeListener = function(o){
      var a = _listeners;   
      var i = a.length;
      while (i--) {
         if (a[i] == o) {
            a.splice (i, 1);
            return true;
         }
      }
   };

   this.broadcastMessage = function(){
      var arr = new Array();
      for(var i = 0; i < arguments.length; i++){
         arr.push(arguments[i])
      }
      var e = arr.shift();
      var a = _listeners;
      var l = a.length;
      for (var i=0; i<l; i++){
         if(a[i][e])
         a[i][e].apply(a[i], arr);
      }
   };

   // TODO: make this the standard setter
   this.setLookat = function(point) {
      self.lookat = point;
      var e = getElevation([self.lookat], function(results){
         _lookat_elevation = results[0].elevation;
      });
   };
   this.setLookat(self.lookat);

   this.setSize = function(width, height) {
      _w = width;
      _h = height;
      _renderer.setSize( _w, _h );
      _camera.projectionMatrix = THREE.Matrix4.makePerspective( _fov, _w, _h, 1, 1100 );
   };

   this.reset = function() {
      _points = [];
      _headings = [];
      _pitchs = [];
      _mats = [];
      _elevations = [];

      _lat = 0;
      _lon = 0;

      _position_x = 0;
      _position_y = 0;

      _point_index = 0;
      _origin_heading = 0;
      _origin_pitch = 0;

      _forward = true;
   };  

   this.generate = function( route ) {

      if(route) {
         handleDirectionsRoute(route);
      } else {
 
         if(!self.start==null || !self.end==null) {
            console.log("no start or end point");
            return;
         } 

         var route = { label:'Hyperlapse',
            request:{
               origin: self.start, 
               destination: self.end, 
               travelMode: google.maps.DirectionsTravelMode.DRIVING},
            rendering:{draggable:false}
         };

         _directions_service.route(route.request, function(response, status) {
            if (status == google.maps.DirectionsStatus.OK) {
               self.broadcastMessage('onRoute',{response: response});
               handleDirectionsRoute(response);
            } else {
               console.log(status);
            }
         });
         
      }
      
   };  

   this.animate = function() {
      requestAnimationFrame( self.animate );
      self.render();
   };

   this.render = function() {
      var t = _point_index/(self.length()-1);

      var o_heading = -_origin_heading.toDeg();
      o_heading += _lookat_heading;
      
      var o_pitch = -(_origin_pitch.toDeg());
      o_pitch = _position_y;

      var olon = _lon, olat = _lat;
      _lon = _lon + ( o_heading - olon );
      _lat = _lat + ( o_pitch - olat );

      _lat = Math.max( - 85, Math.min( 85, _lat ) );
      var phi = ( 90 - _lat ).toRad();
      var theta = _lon.toRad();

      _camera.target.x = 500 * Math.sin( phi ) * Math.cos( theta );
      _camera.target.y = 500 * Math.cos( phi );
      _camera.target.z = 500 * Math.sin( phi ) * Math.sin( theta );
      _camera.lookAt( _camera.target );
      _camera.rotation.z -= _origin_pitch - self.tilt;
      
      _renderer.render( _scene, _camera );
   };

   this.play = function() {
      _is_running = true;
      _interval = setInterval(self.loop, _millis);
   };

   this.pause = function() {
      window.clearInterval( _interval );
      _is_running = false;
   };

   this.loop = function () {
      _mesh.material.map = _mats[_point_index]; 
      _mesh.material.map.needsUpdate = true;
      _origin_heading = _headings[_point_index];
      _origin_pitch = _pitchs[_point_index];
      _lookat_heading = google.maps.geometry.spherical.computeHeading(_points[_point_index], self.lookat);

      var e = _elevations[_point_index].elevation - self.elevation_offset;
      var d = google.maps.geometry.spherical.computeDistanceBetween(_points[_point_index], self.lookat);
      var dif = _lookat_elevation - e;
      var angle = Math.atan( Math.abs(dif)/d ).toDeg();
      _position_y = (dif<0) ? -angle : angle;

      self.broadcastMessage('onFrame',{
         position:_point_index, 
         heading: _origin_heading, 
         pitch: _origin_pitch, 
         point: _points[_point_index]
      });

      if(_forward) {
         if(++_point_index == _points.length) {
            _point_index = _points.length-1;
            _forward = !_forward;
         } 
      } else {
         if(--_point_index == -1) {
            _point_index = 0;
            _forward = !_forward;
         } 
      }
   };

}