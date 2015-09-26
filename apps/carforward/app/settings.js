this.app = (function (app, lab) {
	'use strict';
	var sd, sc, lsprefix = 'com.alcatel-lucent.demo.carforwarding.';
	
	sd = {
		user: '',
		name: '',
		calling: 'true',
		password: '',
		forwarding: 'none',
		forwardto: '',
		forwardPlayMessage: 'true',
		beacon: '',
		beaconUuid: lab.beaconUuid,
		beaconMajor: lab.beaconMajor,
		beaconMinor: lab.beaconMinor
	};
	
	function getLS(f) {
		if (window.localStorage) {
			return window.localStorage.getItem(lsprefix + f);
		}
	}
	
	function setLS(f, v) {
		if (window.localStorage) {
			return window.localStorage.setItem(lsprefix + f, v);
		}
	}
	
	function sanitize(data) {
		var f, v;
		for (f in data) {
			if (data.hasOwnProperty(f)) {
				if (typeof data[f] === 'string') {
					data[f] = data[f].trim();
				}
			}
		}
		if (data.user) {
			data.user = app.utils.sanitizeNumber(data.user);
		}
		if (data.forwardto) {
			data.forwardto = app.utils.sanitizeNumber(data.forwardto);
		}
	}
	
	app.settings = {
		get: function () {
			var f, sdcopy = {};
			for (f in sd) {
				if (sd.hasOwnProperty(f)) {
					sdcopy[f] = sd[f];
				}
			}
			return sdcopy;
		},
		set: function (data) {
			var f, i, theOld, theNew;
			theOld = this.get();
			sanitize(data);
			for (f in data) {
				if (data.hasOwnProperty(f) && sd.hasOwnProperty(f)) {
					sd[f] = data[f];
					setLS(f, data[f]);
				}
			}
			theNew = this.get();
			for (f = 0; f < sc.length; f += 1) {
				for (i = 0; i < sc[f].fields.length; i += 1) {
					if (sd[sc[f].fields[i]] !== theOld[sc[f].fields[i]]) {
						app.emit(app.event.SETTINGS_CHANGE, {
							component: sc[f].component,
							oldSettings: theOld,
							newSettings: theNew
						});
						break;
					}
				}
			}
			app.emit(app.event.SETTINGS_CHANGE, {
				component: '',
				oldSettings: theOld,
				newSettings: theNew
			});
		},
		component: {
			CALLING: 'CALLING',
			FORWARDING: 'FORWARDING',
			BEACON: 'BEACON'
		}
	};
	
	sc = [{
		component: app.settings.component.CALLING,
		fields: ['calling', 'user', 'name', 'password']
	}, {
		component: app.settings.component.FORWARDING,
		fields: ['forwarding', 'forwardto', 'user', 'name', 'forwardPlayMessage']
	}, {
		component: app.settings.component.BEACON,
		fields: ['forwarding', 'beacon', 'beaconUuid', 'beaconMajor', 'beaconMinor']
	}];
	
	// Initialize data from local storage
	(function () {
		var f, v;
		for (f in sd) {
			if (sd.hasOwnProperty(f)) {
				v = getLS(f);
				if (v !== null) {
					sd[f] = v;
				}
			}
		}
	}());
	
	return app;
}(this.app || {}, this.defaultConfig));