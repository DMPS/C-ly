this.app = (function (app) {
	'use strict';
	
	app.event = {
		BEACON_MONITORING: 'BEACON_MONITORING',
		BEACON_NEARBY: 'BEACON_NEARBY',
		BEACON_PROXIMITY: 'BEACON_PROXIMITY',
		BEACON_REGION: 'BEACON_REGION',
		CALL_STATE: 'CALL_STATE',
		FORWARDING_REVERSE: 'FORWARDING_REVERSE',
		FORWARDING_STATE: 'FORWARDING_STATE',
		SESSION_ERROR: 'SESSION_ERROR',
		SESSION_STATE: 'SESSION_STATE',
		SETTINGS_CHANGE: 'SETTINGS_CHANGE',
		UI_LOAD: 'UI_LOAD',
		USER_LOGIN: 'USER_LOGIN'
	};
	
	function EventEmitter() {
		var listeners = [];
		this.on = function (event, listener) {
			if (typeof event === 'string' && typeof listener === 'function') {
				listeners.push({ name: event, listener: listener });
			}
			return this;
		};
		this.off = function (event) {
			var i = 0;
			if (!event) {
				event = '*';
			}
			if (event === '*') {
				listeners.splice(0, listeners.length);
				return;
			}
			while (i < listeners.length) {
				if (listeners[i].name === event || event.indexOf(listeners[i].name.split('*')[0]) === 0) {
					listeners.splice(i, 1);
				}
			}
			return this;
		};
		this.emit = function (event, data) {
			var i;
			if (!data) {
				data = {};
			}
			data.name = event;
			for (i = 0; i < listeners.length; i += 1) {
				if (listeners[i].name === event || event.indexOf(listeners[i].name.split('*')[0]) === 0) {
					listeners[i].listener(data);
				}
			}
			return this;
		};
	}
	
	EventEmitter.call(app);
	app.on('*', function (data) {
		window.console.log('[app/emitter] ' + data.name
			+ (data.state !== undefined ? '=' + data.state : '')
			+ (data.id !== undefined ? ', id=' + data.id : '')
			+ (data.component !== undefined ? ', component=' + data.component : '')
			);
	});
	
	return app;
}(this.app || {}));