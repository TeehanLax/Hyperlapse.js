/**
 * Hyperlapse.js / Teehan+Lax Labs
 *
 * Dependancies:
 * https://github.com/mrdoob/three.js
 * https://github.com/pnitsch/GSVPano.js
 * maps.googleapis.com/maps/api/js?v=3.exp
 *
 * @author Peter Nitsch
 */

Number.prototype.toRad = function() {
	return this * Math.PI / 180;
};

Number.prototype.toDeg = function() {
	return this * 180 / Math.PI;
};

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

/**
 * External point
 *
 * @param {LatLng} location 
 * @param {String} pano_id 
 * @param {number} heading 
 * @param {number} pitch 
 * @param {number} elevation 
 * @param {Image} image 
 */

var HyperlapsePoint = function(location, pano_id, heading, pitch, elevation, image ) {

	var self = this;

	this.location = location;
	this.pano_id = pano_id;
	this.heading = heading || 0;
	this.pitch = pitch || 0;
	this.elevation = elevation || 0;
	this.image = image || null;

};

/**
 * @constructor
 * @param {Node} container 
 * @param {opts?} params 
 */

var Hyperlapse = function(container, params) {

	"use strict";

	var self = this,
		_listeners = [],
		_container = container,
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
		_lookat_heading = 0, _lookat_elevation = 0,
		_canvas, _context,
		_camera, _scene, _renderer, _mesh,
		_loader, _cancel_load = false,
		_image = _params.image || null,
		_ctime = Date.now(),
		_ptime = 0, _dtime = 0,
		_prev_pano_id = null,
		_raw_points = [], _h_points = [];

	var handleError = function (e) { if (self.onError) self.onError(e); };
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

	_renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
	_renderer.autoClearColor = false;
	_renderer.setSize( _w, _h );

	_mesh = new THREE.Mesh( new THREE.SphereGeometry( 500, 60, 40 ), new THREE.MeshBasicMaterial( { map: new THREE.Texture() } ) );
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

		_h_points[_point_index].image = canvas;

		if(++_point_index != _h_points.length) {
			handleLoadProgress( {position:_point_index} );

			if(!_cancel_load) {
				_loader.composePanorama( _h_points[_point_index].pano_id );
			} else {
				_cancel_load = false;
				_is_loading = false;
			}
		} else {
			handleLoadComplete( {} );
		}
	};

	var handleLoadProgress = function (e) { if (self.onLoadProgress) self.onLoadProgress(e); };
	var handleLoadComplete = function (e) {
		_is_loading = false;
		_point_index = 0;

		animate();

		if (self.onLoadComplete) self.onLoadComplete(e);
	};

	/* Route functions */

	var handleRouteProgress = function (e) { if (self.onRouteProgress) self.onRouteProgress(e); };
	var handleRouteComplete = function (e) {
		var elevations = [];
		for(var i=0; i<_h_points.length; i++) {
			elevations[i] = _h_points[i].location;
		}

		getElevation(elevations, function(results){
			for(i=0; i<_h_points.length; i++) {
				_h_points[i].elevation = results[i].elevation;
			}
		});

		if (self.onRouteComplete) self.onRouteComplete(e);
	};

	var parsePoints = function(response) {

		_loader.load( _raw_points[_point_index], function() {

			if(_loader.id != _prev_pano_id) {
				_prev_pano_id = _loader.id;

				var hp = new HyperlapsePoint( _loader.location, _loader.id, _loader.rotation, _loader.pitch, _loader.elevation );
				_h_points.push( hp );

				handleRouteProgress( {point: hp} );

				if(_point_index == _raw_points.length-1) {
					handleRouteComplete( {response: response, points: _h_points} );
				} else {
					_point_index++;
					parsePoints(response);
				}
			} else {

				_raw_points.splice(_point_index, 1);

				if(_point_index == _raw_points.length) {
					handleRouteComplete( {response: response, points: _h_points} ); // FIX
				} else {
					parsePoints(response);
				}

			}

		} );
	};

	var getElevation = function(locations, callback) {
		var positionalRequest = { locations: locations };

		_elevator.getElevationForLocations(positionalRequest, function(results, status) {
			if (status == google.maps.ElevationStatus.OK) {
				callback(results);
			} else {
				callback(null);
			}
		});
	};

	var handleDirectionsRoute = function(response) {
		if(!_is_playing) {

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
				if(i+1 < path.length) {

					a = path[i];
					b = path[i+1];
					d = google.maps.geometry.spherical.computeDistanceBetween(a, b);

					if(r > 0 && r < d) {
						a = pointOnLine(r/d, a, b);
						d = google.maps.geometry.spherical.computeDistanceBetween(a, b);
						_raw_points.push(a);

						r = 0;
					} else if(r > 0 && r > d) {
						r -= d;
					}

					if(r === 0) {
						var segs = Math.floor(d/_d);

						if(segs > 0) {
							for(var j=0; j<segs; j++) {
								var t = j/segs;

								if( t>0 || (t+i)===0  ) { // not start point
									var way = pointOnLine(t, a, b);
									_raw_points.push(way);
								}
							}

							r = d-(_d*segs);
						} else {
							r = _d*( 1-(d/_d) );
						}
					}

				} else {
					_raw_points.push(path[i]);
				}
			}

			parsePoints(response);

		} else {
			self.pause();
			handleDirectionsRoute(response);
		}
	};

	var drawMaterial = function() {
		_mesh.material.map.image = _h_points[_point_index].image;
		_mesh.material.map.needsUpdate = true;

		_origin_heading = _h_points[_point_index].heading;
		_origin_pitch = _h_points[_point_index].pitch;
		_lookat_heading = google.maps.geometry.spherical.computeHeading( _h_points[_point_index].location, self.lookat );

		var e = _h_points[_point_index].elevation - self.elevation_offset;
		var d = google.maps.geometry.spherical.computeDistanceBetween( _h_points[_point_index].location, self.lookat );
		var dif = _lookat_elevation - e;
		var angle = Math.atan( Math.abs(dif)/d ).toDeg();

		if(self.useElevation) _position_y = (dif<0) ? -angle : angle;

		handleFrame({
			position:_point_index,
			point: _h_points[_point_index]
		});
	};

	var render = function() {
		if(!_is_loading && self.length()>0) {
			var t = _point_index/(self.length());

			var o_x = self.position.x + (self.offset.x * t);
			var o_y = self.position.y + (self.offset.y * t);
			var o_z = self.tilt + (self.offset.z.toRad() * t);

			var o_heading = (self.use_lookat) ? _lookat_heading - _origin_heading.toDeg() + o_x : o_x;
			var o_pitch = _position_y + o_y;

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
			_camera.rotation.z -= o_z;

			if(self.use_rotation_comp) {
				_camera.rotation.z -= self.rotation_comp.toRad();
			}
			_mesh.rotation.z = _origin_pitch.toRad();
			_renderer.render( _scene, _camera );
		}
	};

	var animate = function() {
		var ptime = _ctime;
		_ctime = Date.now();
		_dtime += _ctime - ptime;
		if(_dtime >= self.millis) {
			if(_is_playing) loop();
			_dtime = 0;
		}

		requestAnimationFrame( animate );
		render();
	};

	// animates the playhead forward or backward depending on direction
	var loop = function() {
		drawMaterial();

		if(_forward) {
			if(++_point_index == _h_points.length) {
				_point_index = _h_points.length-1;
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
	this.elevation_offset = _params.elevation || 0;
	this.tilt = _params.tilt || 0;
	this.useElevation = true;
	this.position = {x:0, y:0};
	this.offset = {x:0, y:0, z:0};
	this.use_lookat = true;

	this.use_rotation_comp = false;
	this.rotation_comp = 0;

	this.isPlaying = function() { return _is_playing; };
	this.isLoading = function() { return _is_loading; };
	this.length = function() { return _h_points.length; };
	this.setPitch = function(v) { _position_y = v; };
	this.setDistanceBetweenPoint = function(v) { _distance_between_points = v; };
	this.setMaxPoints = function(v) { _max_points = v; };
	this.fov = function() { return _fov; };
	this.webgl = function() { return _renderer; };

	/**
	 * 
	 */

	this.getCurrentPano = function() {
		return _h_points[_point_index].image;
	};

	/**
	 * 
	 */

	this.setLookat = function(point) {
		self.lookat = point;
		var e = getElevation([self.lookat], function(results){
			_lookat_elevation = results[0].elevation;
		});
	};
	this.setLookat(self.lookat);

	/**
	 * 
	 */

	this.setFOV = function(value) {
		_fov = Math.floor(value);
		_camera.projectionMatrix = THREE.Matrix4.makePerspective( _fov, _w/_h, 1, 1100 );
	};

	/**
	 * 
	 */

	this.setSize = function(width, height) {
		_w = width;
		_h = height;
		_renderer.setSize( _w, _h );
		_camera.projectionMatrix = THREE.Matrix4.makePerspective( _fov, _w/_h, 1, 1100 );
	};

	/**
	 * 
	 */

	this.reset = function() {
		_raw_points.remove(0,-1);
		_h_points.remove(0,-1);

		//self.elevation_offset = 0;
		self.tilt = 0;

		_lat = 0;
		_lon = 0;

		self.position.x = 0;
		self.position.y = 0;
		self.offset.x = 0;
		self.offset.y = 0;
		self.offset.z = 0;
		_position_x = 0;
		_position_y = 0;

		_point_index = 0;
		_origin_heading = 0;
		_origin_pitch = 0;

		_forward = true;
		_is_loading = false;
	};

	/**
	 * 
	 */

	this.generate = function( parameters ) {

		if(!_is_loading) {
			_is_loading = true;
			self.reset();

			var params = parameters || {};
			_distance_between_points = params.distance_between_points || _distance_between_points;
			_max_points = params.max_points || _max_points;

			if(params.route) {
				handleDirectionsRoute(params.route);
			} else {
				if(self.start===null || self.end===null) {
					console.log("no start or end point");
					return;
				}

				var route = { label:'Hyperlapse',
					request:{
						origin: self.start,
						destination: self.end,
						travelMode: google.maps.DirectionsTravelMode.DRIVING
					},
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

		}

	};

	/**
	 * 
	 */

	this.load = function() {
		_point_index = 0;
		_loader.composePanorama(_h_points[_point_index].pano_id);
	};

	/**
	 * 
	 */

	this.cancelLoad = function() {
		if(_is_loading) _cancel_load = true;
	};

	/**
	 * 
	 */

	this.getCameraPosition = function() {
		return {lat: _lat, lon: _lon};
	};

	

	/**
	 * Animate through all frames in sequence
	 */

	this.play = function() {
		if(!_is_loading) _is_playing = true;
	};

	/**
	 * Pause animation
	 */

	this.pause = function() {
		_is_playing = false;
	};

	/**
	 * Display next frame in sequence
	 */

	this.next = function() {
		self.pause();

		if(_point_index+1 != _h_points.length) {
			_point_index++;
			drawMaterial();
		}
	};

	/**
	 * Display previous frame in sequence
	 */

	this.prev = function() {
		self.pause();

		if(_point_index-1 !== 0) {
			_point_index--;
			drawMaterial();
		}
	};
};