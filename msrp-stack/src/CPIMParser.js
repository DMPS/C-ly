/*
 * Copyright (c) 2013 Alcatel-Lucent
 *
 */

var CrocMSRP = (function(CrocMSRP) {
	var lineEnd = '\r\n';
	
	/**
	 * Create a CPIM message
	 * @class Create the parsed CPIMMessage.
	 * @private
	 */
	CrocMSRP.CPIMMessage = function() {
		this.contentType = null;
		this.from = null;
		this.to = null;
		this.cc = null;
		this.dateTime = null;
		this.contentDisposition = null;
		this.subject = null;
		this.ns = null;
		this.require = null;
		this.headers = {};
	};

	CrocMSRP.CPIMMessage.prototype.addHeader = function(name, value) {
		// Standard headers are stored in their own properties
		switch (name) {
		case 'To':
			this.to = value;
			return;
		case 'From':
			this.from = value;
			return;
		case 'cc':
			this.cc = value;
			return;
		case 'Content-Type':
			this.contentType = value;
			return;
		case 'DateTime':
			this.dateTime = value;
			return;
		case 'Subject':
			this.subject = value;
			return;
		case 'NS':
			this.ns = value;
			return;
		case 'Require':
			this.require = value;
			return;
		case 'Content-Disposition':
			this.contentDisposition = value;
			return;
		default:
			break;
		}
		
		console.log("add cpim header, name: " + name + ", value: " + value);
		if (this.headers[name]) {
			this.headers[name].push(value);
		} else {
			this.headers[name] = [value];
		}
	};
	/**
	 * Parses a raw websocket message and returns a Message object.
	 * @param {CrocMSRP.CPIMMessage} the parsed msrp message.
	 * @private
	 */
	CrocMSRP.parseCPIMMessage = function(msrpReq) {
		console.log("Enter parseCPIMMessage().");
		var msg, startIndex = 0, endIndex, parseResult, data;
		var cpimMessage = new CrocMSRP.CPIMMessage();
		
		data = msrpReq.body;
		if (data instanceof ArrayBuffer) {
			// Turn the ArrayBuffer into a string, assuming one-byte chars
			// The body will get sliced out once we locate it
			console.debug("data is ArrayBuffer") ;
			msg = String.fromCharCode.apply(null, new Uint8Array(data)); 
		} else if (data instanceof String || typeof data === 'string') {
			console.debug("data is String") ;
			msg = data;
		} else {
			console.log('Unexpected parameter type');
			return null;
		}
		
		console.log("CPIM message: " + msg);
		while (true) {
			parseResult = getNextHeader(msg, startIndex, cpimMessage);
			if (parseResult > 0) {
				startIndex = parseResult;
			} else if (parseResult === 0) {
				break;
			} else {
				return null;
			}
		}
		
		// Perform further processing on selected headers
		if (!cpimMessage.parseKnownHeaders(cpimMessage)) {
			console.log("Error parsing message: parseKnownHeaders failed");
			return null;
		}
		
		// Extract the message body (if present)
		startIndex += lineEnd.length;

		if (cpimMessage.contentType.match(/application\/octet-stream/)) {
			// Slice out the body of the CPIM message from the original ArrayBuffer
			console.log("parseCPIMMessage. Body startIndex "+ startIndex + ", endIndex " + endIndex) ;
			msrpReq.body = data.slice(startIndex, endIndex);
		} else {
			// Assume we're only dealing with text
			console.log("parseCPIMMessage(): Incoming chunk: NOT ArrayBuffer. startIndex "+ startIndex + ", endIndex " + endIndex) ;
			msrpReq.body = msg.substring(startIndex, endIndex);
			console.log("parseCPIMMessage msrpReq.body:" + msrpReq.body) ;
		}
	};

	/**
	 * Remove any leading or trailing whitespace from the provided string.
	 * @param {String} str The string to process.
	 * @returns {String} The trimmed string.
	 * @private
	 */
	function chomp(str) {
		return str.replace(/^\s+/, '').replace(/\s+$/, '');
	}
	
	/**
	 * Remove double quotes from the start and end of the string, if present.
	 * @param {String} str The string to process.
	 * @returns {String} The unquoted string.
	 * @private
	 */
	function unq(str) {
		return str.replace(/^"/, '').replace(/"$/, '');
	}

	// Extracts the next header after startIndex, and adds it to the provided message object
	// Returns: Positive value: the new message position when a header is extracted
	//          0 if there are no more headers
	//          -1 if it encounters an error
	function getNextHeader(msg, startIndex, cpimMessage) {
		var endIndex, colonIndex, name, value;
		
		if (msg.substr(startIndex, 2) === '\r\n'){
			startIndex += 2;
			if (msg.indexOf(':', startIndex) === -1) {
				return 0;
			}
		}
		
		endIndex = msg.indexOf('\r\n', startIndex);

		if (endIndex === -1) {
			// Oops - invalid message
			console.log('Error parsing header: no CRLF');
			return -1;
		}

		colonIndex = msg.indexOf(':', startIndex);
		if (colonIndex === -1) {
			// Oops - invalid message
			console.log('Error parsing header: no colon');
			return -1;
		}
		
		name = chomp(msg.substring(startIndex, colonIndex));
		if (name.length === 0) {
			console.log('Error parsing header: no name');
			return -1;
		}
		
		value = chomp(msg.substring(colonIndex + 1, endIndex));
		if (name.length === 0) {
			console.log('Error parsing header: no value');
			return -1;
		}
		
		console.log("getNextHeader(). Got header: " + name + ": " + value);
		cpimMessage.addHeader(name, value);
		
		return endIndex + 2;
	}

	function parseFrom(headerArray, cpimMessage) {
		// We only expect one From header
		if (headerArray.length !== 1) {
			console.log('Multiple From headers');
			return false;
		}
		
		cpimMessage.from = headerArray[0];
		
		return true;
	}
	
	function parseTo(headerArray, cpimMessage) {
		// We only expect one To header
		if (headerArray.length !== 1) {
			console.log('Multiple From headers');
			return false;
		}
		
		cpimMessage.to = headerArray[0];
		
		return true;
	}

	function parseCc(headerArray, cpimMessage) {
		// We only expect one cc header
		if (headerArray.length !== 1) {
			console.log('Multiple From headers');
			return false;
		}
		
		cpimMessage.cc = headerArray[0];
		
		return true;
	}
	
	function parseSubject(headerArray, cpimMessage) {
		// We only expect one Subject header
		if (headerArray.length !== 1) {
			console.log('Multiple Subject headers');
			return false;
		}
		
		cpimMessage.subject = headerArray[0];
		
		return true;
	}
	
	function parseDateTime(headerArray, cpimMessage) {
		// We only expect one DateTime header
		if (headerArray.length !== 1) {
			console.log('Multiple DateTime headers');
			return false;
		}
		
		cpimMessage.dateTime = headerArray[0];
		
		return true;
	}
	
	function parseNS(headerArray, cpimMessage) {
		// We only expect one NS header
		if (headerArray.length !== 1) {
			console.log('Multiple NS headers');
			return false;
		}
		
		cpimMessage.ns = headerArray[0];
		
		return true;
	}
	
	function parseRequire(headerArray, cpimMessage) {
		// We only expect one Require header
		if (headerArray.length !== 1) {
			console.log('Multiple Subject headers');
			return false;
		}
		
		cpimMessage.require = headerArray[0];
		
		return true;
	}
	
	function parseCPIMContentDisposition(headerArray, cpimMessage) {
		var splitValue, index, splitParam;
		
		// We only expect one Content-Disposition header
		if (headerArray.length !== 1) {
			console.log('Multiple Content-Disposition headers');
			return false;
		}
		
		splitValue = headerArray[0].split(';');
		if (splitValue.length < 1) {
			console.log('Unexpected Content-Disposition header: ' + headerArray[0]);
			return false;
		}
		
		cpimMessage.contentDisposition = {};
		cpimMessage.contentDisposition.type = chomp(splitValue.shift());
		cpimMessage.contentDisposition.param = {};
		for (index in splitValue) {
			splitParam = splitValue[index].split('=');
			if (splitParam.length !== 2) {
				console.log('Unexpected Content-Disposition param: ' + splitValue[index]);
				return false;
			}
			
			cpimMessage.contentDisposition.param[chomp(splitParam[0])] = unq(chomp(splitParam[1]));
		}
		
		return true;
	}

	function parseCPIMContentType(headerArray, cpimMessage) {
		// We expect one or no header
		if (headerArray.length > 1) {
			console.log('Multiple Content-Type headers');
			return false;
		}
		if (headerArray[0]) {
			cpimMessage.contentType = chomp(headerArray[0]);
			if (cpimMessage.contentType.length < 1 ||
				cpimMessage.contentType.match(/text\/plain|application\/octet-stream/)) {
				console.log('parsed content type: ' + msgObj.contentType);
			} else {
				console.warn("Unknow content type: " + msgObj.contentType);
				return false;
			}
		}
		
		return true;
	}
	
	var cpimHeaderParsers = {
		'Content-Type': parseCPIMContentType,
		'From': parseFrom,
		'To': parseTo,
		'cc': parseCc,
		'DateTime': parseDateTime,
		'Content-Disposition': parseCPIMContentDisposition,
		'Subject': parseSubject,
		'NS': parseNS,
		'Require': parseRequire,
	};
	
	CrocMSRP.CPIMMessage.prototype.parseKnownHeaders = function(cpimMessage) {
		var header, parseFn;
		for (header in cpimMessage.headers) {
			parseFn = cpimHeaderParsers[header];
			if (!parseFn) {
				// Ignore unknown headers
				continue;
			}
			
			if (!parseFn(cpimMessage.headers[header], cpimMessage)) {
				console.log('Parsing failed for header ' + header);
				return false;
			}
		}
		
		return true;
	}
	
	return CrocMSRP;
}(CrocMSRP || {}));

