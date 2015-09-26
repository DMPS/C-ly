this.app = (function (app) {
	'use strict';
	var cb, dcb, locationManager, isNearby = false, region = false, delegate,
		pending, authorized = false, bluetooth = false, idCount = 0, bufferCount = 10;
	
	function debug(msg, level) {
		if (!level) {
			window.console.debug('[app/beacon] ' + msg);
		}
		app.ui.debugBeacon(msg, level);
	}
	function log(msg) {
		window.console.log('[app/beacon] ' + msg);
		debug(msg, 'LOG');
	}
	function warn(msg) {
		window.console.warn('[app/beacon] ' + msg);
		debug(msg, 'WARN');
	}
	
	function authorize2(callback, auth) {
		locationManager.isBluetoothEnabled().then(function (isEnabled) {
			if (!isEnabled) {
				locationManager.enableBluetooth()
					.fail(function () {
						warn('Bluetooth not enabled. Please enable Bluetooth to monitor beacons.');
						app.ui.alert('Bluetooth not enabled. Please enable Bluetooth to monitor beacons.');
						bluetooth = false;
						callback(false);
					})
					.done(function () {
						bluetooth = true;
						callback(auth);
					});
			} else {
				bluetooth = true;
				callback(auth);
			}
		});
	}
	
	function authorize(callback) {
		if (!authorized && navigator.userAgent.match(/iPad|iPhone|iPod/i)) {
			locationManager.requestWhenInUseAuthorization()
				.fail(function () {
					warn('Location Management was not authorized. Cannot monitor beacons.');
					app.ui.alert('Location Management was not authorized. Cannot monitor beacons.');
					authorized = false;
					authorize2(callback, false);
				})
				.done(function () {
					authorized = true;
					authorize2(callback, true);
				});
		} else {
			authorized = true;
			authorize2(callback, true);
		}
	}
	
	function updateRegion() {
		if (region === false) {
			log('updateMonitoring() No new monitoring');
			app.emit(app.event.BEACON_MONITORING, {
				state: app.beacon.state.SUCCESS,
				region: region
			});
			return;
		}
		authorize(function () {
			log('updateMonitoring() authorized=' + authorized + ', bluetooth=' + bluetooth);
			log('updateMonitoring() Start monitoring Identifier=' + region.identifier + ', UUID=' + region.uuid
				+ ', Major=' + region.major + ', Minor=' + region.minor);
			locationManager.startRangingBeaconsInRegion(region)
				.fail(cb.startRangingFail)
				.done(cb.startRangingDone);
		});
	}
	
	cb = {
		startRangingDone: function () {
			log('startRangingDone');
			app.emit(app.event.BEACON_MONITORING, {
				state: app.beacon.state.SUCCESS,
				region: region
			});
		},
		startRangingFail: function () {
			log('startRangingFail');
			app.emit(app.event.BEACON_MONITORING, {
				state: app.beacon.state.ERROR,
				region: region
			});
			region = false;
		},
		stopRangingFail: function () {
			log('stopRangingFail');
			if (region === false) {
				app.emit(app.event.BEACON_MONITORING, {
					state: app.beacon.state.ERROR,
					region: region
				});
			}
			updateRegion();
		}
	};
	
	dcb = {
		didDetermineStateForRegion: function (data) {
			debug('didDetermineStateForRegion() ' + JSON.stringify(data));
		},
		didStartMonitoringForRegion: function (data) {
			debug('didStartMonitoringForRegion() ' + JSON.stringify(data));
		},
		didEnterRegion: function (data) {
			app.emit(app.event.BEACON_REGION, {state: true});
			debug('didEnterRegion() ' + JSON.stringify(data));
		},
		didExitRegion: function (data) {
			app.emit(app.event.BEACON_REGION, {state: false});
			debug('didExitRegion() ' + JSON.stringify(data));
		},
		didRangeBeaconsInRegion: function (data) {
			var i, p = '';
			debug(JSON.stringify(data));
			if (data.beacons && data.beacons.length > 0) {
				for (i = 0; i < data.beacons.length; i += 1) {
					p = data.beacons[i].proximity;
					if (p) {
						app.emit(app.event.BEACON_PROXIMITY, {state: p});
					}
					if (p === 'ProximityNear' || p === 'ProximityImmediate') {
						bufferCount = 0;
						if (!isNearby) {
							app.emit(app.event.BEACON_NEARBY, {state: true, region: region});
						}
						isNearby = true;
						debug('didRangeBeaconsInRegion() proximity=' + p + ', isNearby=' + isNearby);
						return;
					}
				}
			}
			if (!p) {
				app.emit(app.event.BEACON_PROXIMITY, {state: ''});
			}
			if (bufferCount < 10) {
				bufferCount += 1;
			}
			if (bufferCount > 1) {
				if (isNearby) {
					app.emit(app.event.BEACON_NEARBY, {state: false, region: region});
				}
				isNearby = false;
			}
			debug('didRangeBeaconsInRegion() proximity=' + p + ', isNearby=' + isNearby);
		}
	};
	
	app.beacon = {
		setPlugin: function (obj) {
			var f;
			log('setPlugin()');
			locationManager = obj;
			delegate = new locationManager.Delegate();
			for (f in dcb) {
				if (dcb.hasOwnProperty(f)) {
					delegate[f] = dcb[f];
				}
			}
			locationManager.setDelegate(delegate);
			if (pending) {
				app.beacon.updateMonitoring(pending);
				pending = undefined;
			}
		},
		hasPlugin: function () {
			return !!locationManager;
		},
		isNearby: function () {
			return isNearby;
		},
		getRegion: function () {
			return region;
		},
		updateMonitoring: function (s) {
			if (!locationManager) {
				warn('Beacon plugin not found');
				pending = s || app.settings.get();
				return;
			}
			var oldRegion = region, settings = s || app.settings.get(), identifier;
			if (s === false || !settings.beacon || !settings.beaconUuid || settings.forwarding !== 'mobile') {
				region = false;
				if (isNearby) {
					app.emit(app.event.BEACON_NEARBY, {state: false, region: region});
				}
				isNearby = false;
			} else {
				idCount += 1;
				identifier = 'myBeacon' + idCount;
				region = new locationManager.BeaconRegion(identifier,
					settings.beaconUuid, settings.beaconMajor, settings.beaconMinor);
			}
			isNearby = false;
			app.emit(app.event.BEACON_NEARBY, {state: false});
			app.emit(app.event.BEACON_MONITORING, {
				state: app.beacon.state.TRYING,
				region: region
			});
			if (oldRegion) {
				log('updateMonitoring() Stop monitoring Identifier=' + oldRegion.identifier + ', UUID=' + oldRegion.uuid
					+ ', Major=' + oldRegion.major + ', Minor=' + oldRegion.minor);
				locationManager.stopRangingBeaconsInRegion(oldRegion)
					.fail(cb.stopRangingFail)
					.done(updateRegion);
			} else {
				updateRegion();
			}
		},
		state: {
			TRYING: 'TRYING',
			ERROR: 'ERROR',
			SUCCESS: 'SUCCESS'
		}
	};
	
	return app;
}(this.app || {}));