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

// Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
  var rest = this.slice((to || from) + 1 || this.length);
  this.length = from < 0 ? this.length + from : from;
  return this.push.apply(this, rest);
};

var pointOnLine = function(t, a, b) {
   var lat1 = a.lat().toRad(), lon1 = a.lng().toRad();
   var lat2 = b.lat().toRad(), lon2 = b.lng().toRad();

   x = lat1 + t * (lat2 - lat1);
   y = lon1 + t * (lon2 - lon1);

   return new google.maps.LatLng(x.toDeg(), y.toDeg());
};

var Hyperlapse = function(container, map, params) {

   var self = this,
      _listeners = [],
      _container = container,
      _map = map,
      _params = params || {},
      _w = _params.width || 800,
      _h = _params.height || 400,
      _d = 20,
      _distance_between_points = _params.distance_between_points || 20,
      _max_points = _params.max_points || 100,
      _fov = _params.fov || 70,
      _zoom = _params.zoom || 1,
      _lat = 0, _lon = 0,
      _position_x = 0, _position_y = 0,
      _is_playing = false, _is_loading = false,
      _point_index = 0, 
      _origin_heading = 0, _origin_pitch = 0,
      _forward = true,
      _lookat_heading = 0, _lookat_elevation = 0, _lookat_enabled = true,
      _canvas, _context,
      _camera, _scene, _renderer, _mesh,
      _loader,
      _image = _params.image || null,
      _ctime = Date.now(),
      _ptime = 0, _dtime = 0,
      _points = [], _headings = [], _pitchs = [], _images = [], _elevations = [];

   var handleRoute = function (e) { if (self.onRoute) self.onRoute(e); };
   var handleError = function (e) { if (self.onError) self.onError(e); };
   var handleLoadProgress = function (e) { if (self.onLoadProgress) self.onLoadProgress(e); };
   var handleLoadComplete = function (e) { _is_loading = false; if (self.onLoadComplete) self.onLoadComplete(e); };
   var handleFrame = function (e) { if (self.onFrame) self.onFrame(e); };
   var handlePlay = function (e) { if (self.onPlay) self.onPlay(e); };
   var handlePause = function (e) { if (self.onPause) self.onPause(e); };

   var _directions_service = new google.maps.DirectionsService();
   var _elevator = new google.maps.ElevationService();
   var _streetview_service = new google.maps.StreetViewService();

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

   _mesh = new THREE.Mesh( new THREE.SphereGeometry( 250, 30, 20 ), new THREE.MeshBasicMaterial( { map: THREE.ImageUtils.loadTexture( 'blank.jpg' ) } ) );
   _mesh.doubleSided = true;
   _scene.add( _mesh );
   
   _container.appendChild( _renderer.domElement );

   _loader = new GSVPANO.PanoLoader( {zoom: _zoom} );
   _loader.onError = function(message) {
      handleError({message:message});
   };

   _loader.onPanoramaLoad = function() {
      var canvas = document.createElement("canvas");
      var context = canvas.getContext('2d');
      canvas.setAttribute('width',this.canvas.width);
      canvas.setAttribute('height',this.canvas.height);
      context.drawImage(this.canvas, 0, 0);

      _images.push( canvas );
      _headings.push(this.rotation);
      _pitchs.push(this.pitch);
      _elevations.push(_points[_point_index]);

      if(++_point_index != _points.length) {
         handleLoadProgress({position:_point_index});

         _loader.load( _points[_point_index] );
      } else {
         handleLoadComplete({});
      
         _point_index = 0;

         getElevation(_elevations, function(results){
            _elevations = results;

            self.animate();  
         });
      }
   };


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

   var addPoint = function(point) {
      _points.push(point);
   }

   var handleDirectionsRoute = function(response) {
      if(!_is_playing) {
         self.reset();
         var route = response.routes[0];
         var path = route.overview_path;
         var legs = route.legs;

         var total_distance = 0;
         for(var i=0; i<legs.length; ++i) {
            total_distance += legs[i].distance.value;
         }

         var segment_length = total_distance/_max_points;
         _d = (segment_length < _distance_between_points) ? _d = _distance_between_points : _d = segment_length;

         var d = 0;
         var r = 0;
         var a, b;

         for(i=0; i<path.length; i++) {
            if(i+1 < path.length-1) {

               a = path[i];
               b = path[i+1];
               d = google.maps.geometry.spherical.computeDistanceBetween(a, b);

               if(r > 0 && r < d) {
                  a = pointOnLine(r/d, a, b);
                  d = google.maps.geometry.spherical.computeDistanceBetween(a, b);
                  addPoint(a);

                  r = 0;
               } else if(r > 0 && r > d) {
                  r -= d; 
               }
               
               if(r == 0) {
                  var segs = Math.floor(d/_d);
   
                  if(segs > 0) {
                     for(var j=0; j<segs; j++) {
                        var t = j/segs;
   
                        if(t!=0 || (t==0&&i==0)  ) { // not start point
                           var way = pointOnLine(t, a, b);
                           addPoint(way);
                        }          
                     } 

                     r = d-(_d*segs);
                  } else {
                     r = _d*( 1-(d/_d) );
                  }
               }

            } else {
               addPoint(path[i]);
            }
         }

         handleRoute({response: response, points: _points});

      } else {
         self.pause();
         handleDirectionsRoute(response);
      } 
   }; 

   var drawMaterial = function() {
      _mesh.material.map.image = _images[_point_index];
      _mesh.material.map.needsUpdate = true;

      _origin_heading = _headings[_point_index];
      _origin_pitch = _pitchs[_point_index];
      _lookat_heading = google.maps.geometry.spherical.computeHeading(_points[_point_index], self.lookat);

      var e = _elevations[_point_index].elevation - self.elevation_offset;
      var d = google.maps.geometry.spherical.computeDistanceBetween(_points[_point_index], self.lookat);
      var dif = _lookat_elevation - e;
      var angle = Math.atan( Math.abs(dif)/d ).toDeg();

      if(self.useElevation) _position_y = (dif<0) ? -angle : angle;

      handleFrame({
         position:_point_index, 
         heading: _origin_heading, 
         pitch: _origin_pitch, 
         point: _points[_point_index]
      });
   };

   var loop = function() {
      drawMaterial();

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

   


   /* public */

   this.start = _params.start || null;
   this.end = _params.end || null;
   this.lookat = _params.lookat || null;
   this.millis = _params.millis || 50;
   this.elevation_offset = _params.elevation_offset || 0;
   this.tilt = _params.tilt || 0;
   this.useElevation = true;
   this.position = {x:0, y:0};

   this.enableLookat = function() { _lookat_enabled = true; };
   this.disableLookat = function() { _lookat_enabled = false };
   this.isPlaying = function() { return _is_playing; };
   this.isLoading = function() { return _is_loading; };
   this.length = function() { return _points.length; };
   this.setPitch = function(v) { _position_y = v; };
   this.setDistanceBetweenPoint = function(v) { _distance_between_points = v; };
   this.setMaxPoints = function(v) { _max_points = v; };
   this.fov = function() { return _fov; };

   // TODO: make this the standard setter
   this.setLookat = function(point) {
      self.lookat = point;
      var e = getElevation([self.lookat], function(results){
         _lookat_elevation = results[0].elevation;
      });
   };
   this.setLookat(self.lookat);

   this.setFOV = function(value) {
      _fov = Math.floor(value);
      _camera.projectionMatrix = THREE.Matrix4.makePerspective( _fov, _w/_h, 1, 1100 );
   };

   this.setSize = function(width, height) {
      _w = width;
      _h = height;
      _renderer.setSize( _w, _h );
      _camera.projectionMatrix = THREE.Matrix4.makePerspective( _fov, _w/_h, 1, 1100 );
   };

   this.reset = function() {
      for(var i=0; i<_images.length; i++) {
         _images[i] = null;
      } 

      _points.remove(0,-1);
      _headings.remove(0,-1);
      _pitchs.remove(0,-1);
      _images.remove(0,-1);
      _elevations.remove(0,-1);

      self.elevation_offset = 0;
      self.tilt = 0;

      _lat = 0;
      _lon = 0;

      self.position.x = 0;
      self.position.y = 0;
      _position_x = 0;
      _position_y = 0;

      _point_index = 0;
      _origin_heading = 0;
      _origin_pitch = 0;

      _forward = true;
      _is_loading = false;
   };  

   this.generate = function( params ) {

      var params = params || {};
      _distance_between_points = params.distance_between_points || _distance_between_points;
      _max_points = params.max_points || _max_points;

      if(params.route) {
         handleDirectionsRoute(params.route);
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
               handleDirectionsRoute(response);
            } else {
               console.log(status);
            }
         });
         
      }
      
   };  

   this.load = function() {
      if(!_is_loading) {
         _is_loading = true;
         _loader.load( _points[_point_index] );
      }
   };

   this.animate = function() {
      var ptime = _ctime;
      _ctime = Date.now();
      _dtime += _ctime - ptime;
      if(_dtime >= self.millis) {
         if(_is_playing) loop();
         _dtime = 0;
      }

      requestAnimationFrame( self.animate );
      self.render();
   };

   this.getCameraPosition = function() {
      return {lat: _lat, lon: _lon};
   }

   this.render = function() {
      var t = _point_index/(self.length()-1);

      var o_heading = (_lookat_enabled) ? _lookat_heading - _origin_heading.toDeg() : self.position.x;
      var o_pitch = (_lookat_enabled) ? _position_y : self.position.y;

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
      _camera.rotation.z -= self.tilt;
      if(_lookat_enabled) _mesh.rotation.z = _origin_pitch.toRad();
      
      _renderer.render( _scene, _camera );
   };

   this.play = function() {
      if(!_is_loading) _is_playing = true;
   };

   this.pause = function() {
      _is_playing = false;
   };

   this.next = function() {
      self.pause();

      if(_point_index+1 != _points.length) {
         _point_index++;
         drawMaterial();
      } 
   };

   this.prev = function() {
      self.pause();

      if(_point_index-1 != 0) {
         _point_index--;
         drawMaterial();
      } 
   };
}