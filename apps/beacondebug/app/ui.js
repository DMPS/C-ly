this.app = (function (app) {
	'use strict';
	var el = {}, collecting = false, logs = [];
	
	function saveSettings() {
		var f, data = {}, settings = app.settings.get();
		for (f in settings) {
			if (settings.hasOwnProperty(f) && el.settingsform.elements.hasOwnProperty(f)) {
				if (el.settingsform.elements[f].type === 'checkbox') {
					data[f] = el.settingsform.elements[f].checked ? 'true' : '';
				} else {
					data[f] = el.settingsform.elements[f].value;
				}
			}
		}
		app.settings.set(data);
	}
	
	function loadSettings() {
		var f, settings = app.settings.get();
		for (f in settings) {
			if (settings.hasOwnProperty(f) && el.settingsform.elements.hasOwnProperty(f)) {
				if (el.settingsform.elements[f].type === 'checkbox') {
					el.settingsform.elements[f].checked = (!!settings[f]);
					if (settings[f]) {
						el.settingsform.elements[f].setAttribute('checked', 'checked');
					} else {
						el.settingsform.elements[f].removeAttribute('checked');
					}
				} else {
					el.settingsform.elements[f].value = settings[f];
					if (isNaN(el.settingsform.elements[f].length)) {
						el.settingsform.elements[f].setAttribute('value', settings[f]);
					}
				}
			}
		}
	}
	
	app.ui = {
		start: function (event) {
			var settings = app.settings.get();
			settings.beacon = 'true';
			settings.forwarding = 'mobile';
			collecting = true;
			logs.splice(0, logs.length);
			el.logdisplay.style.display = '';
			el.logdisplay.innerHTML = '';
			el.settingsform.beaconDebugLog.value = '';
			el.settingsform.beaconDebugLog.style.display = 'none';
			app.ui.debugBeacon('======= Beacon Log =======');
			app.beacon.updateMonitoring(settings);
			el.settingsform.debugStart.disabled = true;
			el.settingsform.debugStop.disabled = false;
			if (event && event.preventDefault) {
				event.preventDefault();
			}
		},
		stop: function (event) {
			collecting = false;
			app.beacon.updateMonitoring(false);
			el.logdisplay.style.display = 'none';
			el.logdisplay.innerHTML = '';
			el.settingsform.beaconDebugLog.value = logs.join('\r\n');
			el.settingsform.beaconDebugLog.style.display = '';
			//el.settingsform.beaconDebugLog.select();
			el.settingsform.debugStart.disabled = false;
			el.settingsform.debugStop.disabled = true;
			if (event && event.preventDefault) {
				event.preventDefault();
			}
		},
		save: function (event) {
			saveSettings();
			if (event && event.preventDefault) {
				event.preventDefault();
			}
			
		},
		revert: function (event) {
			loadSettings();
			if (event && event.preventDefault) {
				event.preventDefault();
			}
		},
		clear: function (event) {
			el.settingsform.beaconDebugLog.value = '';
			if (event && event.preventDefault) {
				event.preventDefault();
			}
		},
		debugBeacon: function (msg, level) {
			if (collecting) {
				var time, scrolldown, e = document.documentElement, n;
				scrolldown = (window.scrollY > e.scrollHeight - e.clientHeight - 30);
				time = '[' + (/(\d{2}:\d{2}:\d{2})/).exec(new Date().toTimeString())[1] + '] ';
				logs.push(time + msg);
				n = document.createElement('p');
				n.innerHTML = time + msg;
				el.logdisplay.appendChild(n);
				if (scrolldown) {
					document.body.scrollTop =  e.scrollHeight;
				}
			}
		}
	};
	
	// Init on page load -----------
	
	window.addEventListener('load', function () {
		var e;
		
		// Close communications on page exit
		window.onbeforeunload = function () {
			app.beacon.updateMonitoring(false);
		};
		
		// If container app, load Cordova
		if (navigator.userAgent.match(/Android|iPad|iPhone|iPod/i)) {
			e = document.createElement('script');
			e.type = 'text/javascript';
			e.src = '../../cordova.js';
			document.head.appendChild(e);
			document.addEventListener('deviceready', function () {
				// Configure plugins
				var e, cordova = window.cordova;
				if (cordova.logger) {
					cordova.logger.level('DEBUG');
				}
				if (cordova.plugins) {
					if (cordova.plugins.locationManager) {
						app.beacon.setPlugin(cordova.plugins.locationManager);
					}
				}
			}, false);
		}
		
		el.logdisplay = document.getElementById('logdisplay');
		el.settingsform = document.getElementById('settingsform');
		el.settingsform.beaconDebugLog.style.display = 'none';
		el.settingsform.debugStart.addEventListener('click', app.ui.start);
		el.settingsform.debugStop.addEventListener('click', app.ui.stop);
		el.settingsform.save.addEventListener('click', app.ui.save);
		el.settingsform.revert.addEventListener('click', app.ui.revert);
		el.settingsform.debugStop.disabled = true;
		
		loadSettings();
		
	});
	
	return app;
}(this.app || {}));