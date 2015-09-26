this.app = (function (app, lab) {
	'use strict';
	
	function normalizeLeadingChars(v) {
		// If puidPrefix ends in "+1" or "1", make sure they are not duplicated in the number,
		// i.e. prevent malformed numbers like +1+13335550001 and 113335550001.
		if (v.indexOf('+1') === 0 && lab.puidPrefix.slice(lab.puidPrefix.length - 2) === '+1') {
			v = v.replace('+1', '');
		} else if (v.length === 11 && v[0] === '1' && lab.puidPrefix[lab.puidPrefix.length - 1] === '1') {
			v = v.replace('1', '');
		}
		return v;
	}
	
	app.utils = {
		sanitizeNumber: function (v) {
			v = this.getNumberFromPublicId(v);
			v = normalizeLeadingChars(v);
			return v;
		},
		sanitizePublicId: function (v) {
			if (!v || typeof v !== 'string') {
				return '';
			}
			// Looks like a full public id
			if (v.indexOf(':') > -1) {
				return v;
			}
			// Looks like a public id minus the "sip:"
			if (v.indexOf('@') > -1) {
				return 'sip:' + v;
			}
			// Looks like a phone number
			if (v.match(/^\d/)) {
				v = normalizeLeadingChars(v);
				return lab.puidPrefix + v + lab.puidSuffix;
			}
			// Looks like something else
			if (lab.puidPrefix.indexOf('sip:') === 0) {
				// Remove any characters after "sip:" in the prefix
				return 'sip:' + v + lab.puidSuffix;
			}
			return lab.puidPrefix + v + lab.puidSuffix;
		},
		getNumberFromPublicId: function (address, keepPrefix) {
			// Get number from public ID
			// If it matches the Public ID Prefix, then return everything after the prefix and
			// before any "@" character.
			// If it matches the Public ID Prefix when "sip:" is replaced with "tel:" or vice versa,
			// then return everything after the prefix and before "@".
			// (If keepPrefix is true, then ignore all previous rules.)
			// If it begins with "sip:" or "tel:", return everything between that and "@".
			// Otherwise return everything before "@".
			var start, end, puidprefix = lab.puidPrefix;
			if (typeof address !== 'string') {
				return '';
			}
			start = -1;
			if (!keepPrefix) {
				start = address.indexOf(puidprefix);
				if (start > -1) {
					start += puidprefix.length;
				} else {
					start = address.replace('tel:', 'sip:').indexOf(puidprefix);
					if (start < 0) {
						start = address.replace('sip:', 'tel:').indexOf(puidprefix);
					}
					if (start > -1) {
						start += puidprefix.length;
					}
				}
			}
			if (start < 0) {
				start = address.indexOf('sip:');
				if (start < 0) {
					start = address.indexOf('tel:');
				}
				if (start > -1) {
					start += 4;
				} else {
					start = 0;
				}
			}
			end = address.indexOf('@');
			if (end < 0) {
				end = address.length;
			}
			return address.substring(start, end);
		},
		getPrettyNumber: function (address) {
			// Format "+13335550001" numbers in "(333) 555-0001" format.
			// Otherwise, just return the sanitized number.
			var pn, match, usnumber = /^\+1(\d{10})$/;
			pn = app.utils.getNumberFromPublicId(address, true);
			match = usnumber.exec(pn);
			if (match) {
				pn = match[1];
				return '(' + pn.slice(0, 3) + ') ' + pn.slice(3, 6) + '-' + pn.slice(6, 10);
			}
			return app.utils.sanitizeNumber(address);
		}
	};
	
	return app;
}(this.app || {}, this.defaultConfig));