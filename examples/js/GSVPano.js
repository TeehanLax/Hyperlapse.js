var GSVPANO = GSVPANO || {};
GSVPANO.PanoLoader = function (parameters) {

	'use strict';

	var _parameters = parameters || {},
		_location,
		_zoom,
		_panoId,
		_panoClient = new google.maps.StreetViewService(),
		_count = 0,
		_total = 0,
		_canvas = document.createElement('canvas'),
		_ctx = _canvas.getContext('2d'),
		rotation = 0,
		pitch = 0,
		copyright = '',
		onSizeChange = null,
		onPanoramaLoad = null;
		
	this.setProgress = function (p) {
	
		if (this.onProgress) {
			this.onProgress(p);
		}
		
	};

	this.throwError = function (message) {
	
		if (this.onError) {
			this.onError(message);
		} else {
			console.error(message);
		}
		
	};

	this.adaptTextureToZoom = function () {
	
		var w = 416 * Math.pow(2, _zoom),
			h = (416 * Math.pow(2, _zoom - 1));
		_canvas.width = w;
		_canvas.height = h;
		_ctx.translate( _canvas.width, 0);
		_ctx.scale(-1, 1);
	};

	this.composeFromTile = function (x, y, texture) {
	
		_ctx.drawImage(texture, x * 512, y * 512);
		_count++;
		
		var p = Math.round(_count * 100 / _total);
		this.setProgress(p);
		
		if (_count === _total) {
			this.canvas = _canvas;
			if (this.onPanoramaLoad) {
				this.onPanoramaLoad();
			}
		}
		
	};

	this.composePanorama = function (panoId) {
	
		this.setProgress(0);
		console.log('Loading panorama for zoom ' + _zoom + '...');
		
		var w = (_zoom==3) ? 7 : Math.pow(2, _zoom),
			h = Math.pow(2, _zoom - 1),
			self = this,
			url,
			x,
			y;
				
		_count = 0;
		_total = w * h;
	
		for( y = 0; y < h; y++) {
			for( x = 0; x < w; x++) {
				url = 'http://maps.google.com/cbk?output=tile&panoid=' + panoId + '&zoom=' + _zoom + '&x=' + x + '&y=' + y + '&' + Date.now();
				(function (x, y) { 
					var img = new Image();
					img.addEventListener('load', function () {
						self.composeFromTile(x, y, this);
					});
					img.crossOrigin = '';
					img.src = url;
				})(x, y);
			}
		}
		
	};
	
	this.load = function (location, callback) {
	
		console.log('Load for', location);
		var self = this;
		_panoClient.getPanoramaByLocation(location, 50, function (result, status) {
			if (status === google.maps.StreetViewStatus.OK) {
				if( self.onPanoramaData ) self.onPanoramaData( result );
				rotation = result.tiles.centerHeading * Math.PI / 180.0;
				pitch = result.tiles.originPitch;
				copyright = result.copyright;
				self.copyright = result.copyright;
				_panoId = result.location.pano;
				self.location = location;
				self.rotation = rotation;
				self.pitch = pitch;
				self.image_date = result.imageDate;
				self.id = _panoId;
				callback();
			} else {
				if( self.onNoPanoramaData ) self.onNoPanoramaData( status );
				self.throwError('Could not retrieve panorama for the following reason: ' + status);
				callback();
			}
		});
		
	};
	
	this.setZoom = function( z ) {
		_zoom = z;
		this.adaptTextureToZoom();
	};

	this.setZoom( _parameters.zoom || 1 );

};