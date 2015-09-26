this.app = (function (app, lab) {
	'use strict';
	var cb, req, isFwd, oldFwd, prevFwd, pollingTimer, pollTime = 2000, mobileUser,
		url = lab.carDataUri,
		regid = lab.carRegId,
		data = {
			"vehicle_data": {
				"id": (regid ? regid.slice(-15) : ''),
				"ignition_state": "on",
				"seatbelts": "1"
			},
			"app_data": {
				"driver_name": "User",
				"driver_key": "xxxxxxxxxxxxxx",
				"registrationID": (regid || ''),
				"audible_response": true,
				"privacy": {
					"broadcast": "off",
					"mynumber": "+13335550002",
					"devicename": "personal"
				},
				"forward": {
					"state": "on",
					"numlist": ["+13335550001"],
					"devicenames": ["work"]
				}
			}
		};
	
	function log(msg) {
		window.console.log('[app/callcontrol] ' + msg);
	}
	function warn(msg, callid) {
		window.console.warn('[app/callcontrol] ' + msg);
	}
	
	function getNumberWithPrefix(number) {
		if (!number) {
			return number;
		}
		return app.utils.getNumberFromPublicId(app.utils.sanitizePublicId(number), true);
	}
	
	function carServerRequest(isForwarding, tryAgain, tryAgainData) {
		var fd, settings;
		if (typeof tryAgain !== 'number') {
			tryAgain = 1;
		}
		if (tryAgainData) {
			// Trying again. Use existing copy of settings.
			fd = tryAgainData;
		} else {
			// First try. Get settings.
			settings = app.settings.get();
			fd = {
				isForwarding: isForwarding, //true,
				forwardto: getNumberWithPrefix(settings.forwardto),
				forwardPlayMessage: !!settings.forwardPlayMessage,
				user: getNumberWithPrefix(settings.user),
				name: settings.name || 'User'
			};
			// Verify settings
			if (!url || !regid || !fd.user || !fd.forwardto) {
				warn('Request canceled. Missing parameter url=' + url + ', regid=(' + !!regid + '), user=' + fd.user + ', forwardto=' + fd.forwardto);
				return false;
			}
			// If previous subscription request had different parameters, remove that subscription first
			if (prevFwd && prevFwd.isForwarding && (prevFwd.forwardto !== fd.forwardto
					|| prevFwd.user !== fd.user || prevFwd.name !== fd.name)) {
				carServerRequest(undefined, undefined, {
					isForwarding: false,
					forwardto: prevFwd.forwardto,
					user: prevFwd.user,
					name: prevFwd.name
				});
			}
		}
		
		data.vehicle_data.ignition_state = fd.isForwarding ? 'on' : 'off';
		data.app_data.privacy.mynumber = (fd.forwardto.indexOf('+1') > -1) ? fd.forwardto : ('+1' + fd.forwardto);
		data.app_data.forward.numlist[0] = (fd.user.indexOf('+1') > -1) ? fd.user : ('+1' + fd.user);
		data.app_data.driver_name = fd.name;
		data.app_data.audible_response = !!fd.forwardPlayMessage;
		
		req = new XMLHttpRequest();
		req.open('POST', url + '/cardata');
		req.onreadystatechange = cb.carServerResponse(tryAgain, fd);
		req.setRequestHeader('Content-Type', 'application/json');
		req.send(JSON.stringify(data));
		
		prevFwd = fd;
		app.emit(app.event.FORWARDING_STATE, {
			state: app.callcontrol.state.TRYING,
			isForwarding: isFwd,
			tryForwarding: fd.isForwarding,
			oldForwarding: isFwd,
			httpStatus: undefined
		});
		log('Sent request: ' + JSON.stringify(data));
		return true;
	}
	
	function pollServerRequest(carUser) {
		return function () {
			// Verify settings
			if (!url || !carUser) {
				warn('Request canceled. Missing parameter url=' + url + ', carUser=' + carUser);
				return false;
			}
			req = new XMLHttpRequest();
			req.open('POST', url + '/getsub?num=' + carUser);
			req.onreadystatechange = cb.pollServerResponse(carUser);
			req.send();
			return true;
		};
	}
	
	cb = {
		carServerResponse: function (tryAgain, tryAgainData) {
			return function () {
				var success;
				if (this.readyState !== 4) {
					return;
				}
				req = undefined;
				if (this.status < 200 || this.status > 300) {
					if (tryAgain > 0) {
						log('Status ' + this.status + '. Try ' + tryAgain + ' more times.');
						carServerRequest(undefined, tryAgain - 1, tryAgainData);
						return;
					}
					warn('Failed with status ' + this.status);
					success = false;
				} else {
					log('Success with status ' + this.status);
					isFwd = tryAgainData.isForwarding;
					success = true;
				}
				app.emit(app.event.FORWARDING_STATE, {
					state: success ? app.callcontrol.state.SUCCESS : app.callcontrol.state.ERROR,
					isForwarding: isFwd,
					tryForwarding: tryAgainData.isForwarding,
					oldForwarding: oldFwd ? oldFwd.isForwarding : undefined,
					httpStatus: this.status
				});
				if (this.status >= 200 && this.status < 300) {
					oldFwd = tryAgainData;
				}
			};
		},
		pollServerResponse: function (carUser) {
			return function () {
				if (this.readyState !== 4) {
					return;
				}
				if (this.status < 200 || this.status > 300) {
					app.emit(app.event.FORWARDING_REVERSE, {state: true, mobileUser: mobileUser});
				} else {
					mobileUser = JSON.parse(this.responseText);
					if (mobileUser && mobileUser.data && mobileUser.data.mobile_num) {
						mobileUser = mobileUser.data.mobile_num;
					} else {
						mobileUser = undefined;
					}
					pollingTimer = setTimeout(pollServerRequest(carUser), pollTime);
				}
			};
		}
	};
	
	app.callcontrol = {
		isForwarding: function () {
			return isFwd;
		},
		setForwarding: function (isForwarding) {
			if (isForwarding && typeof isForwarding === 'object') {
				// Data object
				carServerRequest(undefined, undefined, isForwarding);
			} else {
				// Boolean
				carServerRequest(!!isForwarding);
			}
		},
		setPolling: function (isPolling) {
			if (isPolling) {
				var carUser = getNumberWithPrefix(app.settings.get().user);
				mobileUser = undefined;
				clearTimeout(pollingTimer);
				pollingTimer = setTimeout(pollServerRequest(carUser), pollTime);
			} else {
				clearTimeout(pollingTimer);
			}
		},
		state: {
			TRYING: 'TRYING',
			ERROR: 'ERROR',
			SUCCESS: 'SUCCESS'
		}
	};
	
	return app;
}(this.app || {}, this.defaultConfig));