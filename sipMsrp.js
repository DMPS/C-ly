(function () {

	/**
	* Manages an MSRP communication, to be used with SipAdapter.
	* @param {orcaALU.Chat|orcaALU.FileTransfer|orcaALU.ImageShare} comm The MSRP 
	* communication object wrapping this.
	*/
	function SipMsrp(comm) {
		var self = this, i;
		this.comm = comm;
		this.isIncoming = undefined;
		this.isDataChannelOpen = false;
		this.chunkManager = new ChunkManager(this);

		/**
		* Prepare the wrappedCall. This gets called after MsrpCommunication.setWrappedCall.
		*/
		this.setWrappedCall = function (call) {
			this.addCallbacks();
		};

        /**
        * Attempts to reach the recipient and establish a connection. 
        * For an incoming communication, this method is used to accept it.
        */
		this.connect = function () {
			var mediatype, req, outgoingcall;
			if (this.comm.wrappedCall) {
				// Incoming communication (wrappedCall set in orcaALU)
				this.isIncoming = true;
			} else {
				// Outgoing communication
				this.isIncoming = false;
				mediatype = this.comm.type.toLowerCase();
				outgoingcall = this.comm.session.callback.createCall([this.comm.to], mediatype);
				this.comm.setWrappedCall(outgoingcall);
			}
			this.comm.wrappedCall.getCallImp().onDataChannelOnOpen = function () {
				self.onDataChannelOnOpen();
			};
			this.comm.wrappedCall.getCallImp().onDataChannelOnClose = function () {
				self.onDataChannelOnClose();
			};
			this.comm.wrappedCall.createDataChannel();
			this.comm.wrappedCall.connect();
		};

		/**
        * Send a textual message to the other chat participant. 
        * @param {string} message The message content to send
		*/
		this.sendMessage = function (message) {
			if (this.chunkManager && this.comm.type === 'Chat' && this.isDataChannelOpen &&
					this.comm.status === CommStatus.CONNECTED) {
				return this.chunkManager.send(message + ''); // enforce string content
			}
		};

		/**
		* Send the file when the connection is ready.
		* @private
		*/
		this.sendFile = function () {
			if (this.chunkManager && this.comm.file && this.isDataChannelOpen && this.comm.status === CommStatus.CONNECTED) {
                //TEMP: other side's datachannel does not open in time to get immediate message, so delay a bit
				//Raju : Begin

				if(this.useBlob) {
					setTimeout(function () {
						self.chunkManager.send(self.comm.file);
					}, 1000);
				} else {
					// Convery file to ArrayBuffer.. then call this.sendFile()

					var fileReader = new FileReader();
					fileReader.onload = function() {
						arrayBuffer = this.result;
						if(arrayBuffer instanceof File) {
							console.log("this.result is File") ;
						} else if(arrayBuffer instanceof Blob) {
							console.log("this.result is Blob") ;
						} else if(arrayBuffer instanceof ArrayBuffer) {
							console.log("this.result is ArrayBuffer") ;
						} else {
							console.log("this.result is other") ;
						}

						console.log("Converting file to arraybuffer done.. will send it after 1sec. arrayBuffer.length:" + arrayBuffer.byteLength) ;
						setTimeout(function () {
								self.chunkManager.send(arrayBuffer);
								}, 1000);
					};
					console.log("Ready to send file... converting file to arraybuffer") ;
					if(self.comm.file instanceof File) {
						console.log("self.comm.file is File") ;
					} else if(self.comm.file instanceof Blob) {
						console.log("self.comm.file is Blob") ;
					} else {
						console.log("self.comm.file is other") ;
					}
					fileReader.readAsArrayBuffer(self.comm.file);
					//Raju: End
				}
			}
		};

		/**
		* Add callbacks to wrappedCall
		* @private
		*/
		this.addCallbacks = function () {
			var c;
			for (c in this.callbacks) {
				if (this.callbacks.hasOwnProperty(c)) {
					this.comm.wrappedCall[c] = (function (c, sipmsrp) {
						return function () {
							sipmsrp.callbacks[c].apply(sipmsrp, arguments);
						};
					})(c, this);
				}
			}
		};

		/**
		* Deletes allocated resources associated with this
		* @private
		*/
		this.clean = function () {
			var c;
			/*
			if (this.comm.wrappedCall) {
				for (c in this.callbacks) {
					if (this.callbacks.hasOwnProperty(c)) {
						this.comm.wrappedCall[c] = function () {};
					}
				}
				this.comm.wrappedCall = null;
			}
			*/
            if (this.chunkManager.abort()) {
                this.chunkManager = null;
            }
		};

		/**
		* DataChannel open event
		* @private
		*/
		this.onDataChannelOnOpen = function () {
			this.isDataChannelOpen = true;
			this.sendFile();
		};

		/**
		* DataChannel close event
		* @private
		*/
		this.onDataChannelOnClose = function () {
			this.isDataChannelOpen = false;
			if (this.comm.status === CommStatus.CONNECTED) {
                this.comm.callback.onError(CommError.NETWORK_ERROR, {name: CommError.NETWORK_ERROR});
                this.comm.callback.disconnect();
            }
		};

		/**
		* Callbacks for wrappedCall. Note the scope is changed to be SipMsrp instead of Call.
		* @private
		*/
		this.callbacks = {
			onConnected: function () {
				//Raju
				console.log("callbacks.onConnected") ;
				if (!this.chunkManager) {
					return;
				}
				var wcall;
				this.comm.status = CommStatus.CONNECTED;
				if (typeof this.comm.callback.onConnected === 'function') {
					this.comm.callback.onConnected({name: CommStatus.CONNECTED});
				}
				wcall = this.comm.wrappedCall.getCallImp();
				this.chunkManager.initSession(wcall);
				console.log("callbacks.onConnected==>sendFile()") ;
				this.sendFile();
			},
			onDisconnected: function () {
				this.comm.status = CommStatus.DISCONNECTED;
				if (typeof this.comm.callback.onDisconnected === 'function') {
					this.comm.callback.onDisconnected({name: CommStatus.DISCONNECTED});
				}
				this.clean();
			},
			onError: function () {
				if (typeof this.comm.callback.onError === 'function') {
					this.comm.callback.onError(CommError.NETWORK_ERROR, {name: CommError.NETWORK_ERROR});
				}
				this.clean();
			},
			onStatus: function (status, event) {
				switch (status) {
				case CallStatus.REJECTED:
					this.comm.status = CommStatus.DISCONNECTED;
					if (typeof this.comm.callback.onStatus === 'function') {
						this.comm.callback.onStatus(CommStatus.REJECTED, { name: CommStatus.REJECTED });
					}
					this.clean();
					break;
				case CallStatus.CONNECTING:
					this.comm.status = CommStatus.CONNECTING;
					if (typeof this.comm.callback.onStatus === 'function') {
						this.comm.callback.onStatus(CommStatus.CONNECTING, { name: CommStatus.CONNECTING });
					}
					break;
				}
			},
			onMessage: function (msg) {
                if (this.chunkManager) {
                    this.chunkManager.onMessage(msg);
                }
			}
		};

		//End of SipMsrp
	}

	/**
	* Interface with the Crocodile MSRP library
	* @param {SipMsrp} sipmsrp The MSRP manager wrapping this
	*/
	function ChunkManager(sipmsrp) {
		var self = this;
		this.sipmsrp = sipmsrp;
		this.events = {
			onMessageReceived: function (id, contentType, body) {
				console.log('ChunkManager.onMessageReceived ' + id + ' ' + contentType);
				//Raju: TBD
				if (body instanceof ArrayBuffer) {
					body = new Blob([body], {type:contentType});
				}
				self.sipmsrp.comm.callback.onReceived(body, { name: CommStatus.RECEIVED });
				if (self.sipmsrp.comm.type !== 'Chat') {
                    setTimeout(function () { // Give time for the final MSRP OK and REPORT to send
                        console.log('MSRP file complete, now auto-disconnect.');
                        self.sipmsrp.comm.callback.disconnect();
                    }, 500);
				}
			},
			onMessageSent: function (id) {
				console.log('ChunkManager.onMessageSent ' + id);
			},
			onMessageDelivered: function (id) {
				console.log('ChunkManager.onMessageDelivered ' + id);
                self.progressEvent(id);
                self.sipmsrp.comm.callback.onStatus(CommStatus.SENDSUCCESS,
                        { name: CommStatus.SENDSUCCESS, id: id });
                if (self.sipmsrp.comm.type !== 'Chat') {
                    setTimeout(function () { // Give the recipient a chance to disconnect first
                        console.log('MSRP file complete, now auto-disconnect.');
                        self.sipmsrp.comm.callback.disconnect();
                    }, 5000);
                }
			},
			onMessageSendFailed: function (id, status, comment, content) {
				console.log('ChunkManager.onMessageSendFailed', arguments);
                var event = { name: CommStatus.SENDFAIL, id: id };
                if (content && self.sipmsrp.comm.type === 'Chat') {
                    event.content = content;
                }
                self.sipmsrp.comm.callback.onStatus(CommStatus.SENDFAIL, event);
                if (self.sipmsrp.comm.type !== 'Chat') {
                    console.log('MSRP file failed, now auto-disconnect.');
                    self.sipmsrp.comm.callback.disconnect();
                }
			},
			onFirstChunkReceived: function (id, contentType, filename, size, description) {
				console.log('ChunkManager.onFirstChunkReceived', arguments);
                if (self.sipmsrp.comm.type !== 'Chat') {
                    self.totalSize = size;
                    self.progressEvent(id, 0);
                }
			},
			onChunkReceived: function (id, receivedBytes) {
				console.log('ChunkManager.onChunkReceived', arguments);
                if (self.sipmsrp.comm.type !== 'Chat') {
                    self.progressEvent(id, receivedBytes);
                }
			},
			onMessageReceiveAborted: function (id, partialBody) {
				console.log('ChunkManager.onMessageReceiveAborted ' + id);
                if (self.sipmsrp.comm.type !== 'Chat') {
                    console.log('MSRP file aborted, now auto-disconnect.');
                    self.sipmsrp.comm.callback.disconnect();
                }
			}, 
			onMessageReceiveTimeout: function (id) {
				console.log('ChunkManager.onMessageReceiveTimeout ' + id);
				if (self.sipmsrp.comm.type !== 'Chat') {
					console.log('MSRP file timed out, now auto-disconnect.');
					self.sipmsrp.comm.callback.disconnect();
				}
			}, 
			onChunkSent: function (id, sentBytes) {
				console.log('ChunkManager.onChunkSent', arguments);
                if (self.sipmsrp.comm.type !== 'Chat') {
                    self.progressEvent(id, sentBytes);
                }
			}
		};
		this.connection = new Connection(this);
		this.wswrapper = new WSWrapper(this.connection, this.sipmsrp);
		this.session = new Session(this.connection, undefined, undefined, this.events);
		this.connection.ws = this.wswrapper;
		this.totalSize = 0;

		/**
		* Send a message (file or text)
		*/
		this.send = function (content) {
			this.session.send(content);
		}

		/**
		* Trigger when a message is received on the connection.
		* Use to pass messages from wrappedCall datachannel to MSRP library.
		*/
		this.onMessage = function (message) {
			this.wswrapper.onMessage(message);
		}

		/**
		* Cease any sending/receiving and remove events
		*/
		this.abort = function (message) {
            var e;
			this.session.close();
            //TODO make sure all senders and receivers are deactivated and deleted
            /*
            for (e in this.events) {
                if (this.events.hasOwnProperty(e)) {
                    this.events[e] = function () {};
                }
            }
            */
		}

		/**
		* Initialize Session information when it is available
		*/
		this.initSession = function(wcall) {
			this.session.toPath = [wcall.msrpToPath];
			this.session.localUri = new CrocMSRP.Uri(wcall.msrpFromPath);
			this.session.sessionId = wcall.msrpSessionId;
			this.connection.localSessionIds[wcall.msrpSessionId] = this.session;
		}

		/**
		* @private
		* Trigger the progress callback at the API level
		*/
		this.progressEvent = function (id, progress) {
			if (this.sipmsrp.comm.type !== 'Chat') {
                if (progress === undefined) {
                    progress = this.totalSize;
                }
				this.sipmsrp.comm.callback.onStatus(CommStatus.PROGRESS,
                        { name: CommStatus.PROGRESS, id: id, progress: progress, size: this.totalSize });
			}
		};
        
        //End of ChunkManager
	}

	/**
	* Light version of CrocMSRP.Session
	*/
	function Session(con, sessionId, localUri, eventObj) {
		// The connection used by this session
		this.con = con;
		// Local reference to the config object
		this.config = con.config;
		// The session ID (as used in the local URI)
		this.sessionId = sessionId;
		// The local endpoint URI for this session
		this.localUri = localUri;
		// The To-Path header for outgoing requests (set later)
		this.toPath = [];
		// The event notification object provided by the parent application
		this.eventObj = eventObj;
		// A map of in-progress incoming chunked messages (indexed on message ID)
		this.chunkReceivers = {};
		this.receiverCheckInterval = null;
		// A map of in-progress outgoing messages (indexed on message ID)
		this.chunkSenders = {};
		
		/**
		 * Sends a message (or file) over an established session.
		 * @param {String|ArrayBuffer|ArrayBufferView|Blob|File} body The message
		 * body to send (may be binary data/file).
		 * @param {String} [contentType] The MIME type of the provided body.
		 * @returns {String} The Message-ID of the sent message. This can be used
		 * to correlate notifications with the appropriate message.
		 */
		this.send = function(body, contentType) {
			var type, sender, session = this;
			
			// Determine content type & size
			if (body instanceof String || typeof body === 'string') {
				//Raju
				console.log("Session.body is String") ;
				type = contentType || 'text/plain';
			} else if (body instanceof Blob) {
				//Raju
				console.log("Session.body is Blob") ;
				type = contentType || body.type || 'application/octet-stream';
			} else { // ArrayBuffer or view
				//Raju
				console.log("Session.body is ArrayBuffer or other") ;
				type = contentType || 'application/octet-stream';
				//type = contentType || 'message/cpim';
			}
			console.log("Create chunkSender with contentType " + type) ;
			sender = new CrocMSRP.ChunkSender(this, body, type);
			sender.onReportTimeout = makeTimeoutHandler(session, sender.messageId);
			this.con.addSender(sender);
			this.chunkSenders[sender.messageId] = sender;

			return sender.messageId;
		};
		
		/**
		 * Aborts an ongoing message receive.
		 * @param {String} [id] The ID of the message to abort.  If this is
		 * not specified then all incoming messages will be aborted.
		 */
		this.abortReceive = function(id) {
			if (id) {
				var receiver = this.chunkReceivers[id];
				if (!receiver) {
					throw new RangeError('Invalid message id');
				}
				
				receiver.abort();
			} else {
				for (id in this.chunkReceivers) {
					this.chunkReceivers[id].abort();
				}
			}
			// Cleanup will happen when the next chunk is received
		};

		/**
		 * Aborts an ongoing message send.
		 * @param {String} [id] The ID of the message to abort.  If this is
		 * not specified then all outgoing sends will be aborted.
		 */
		this.abortSend = function(id) {
			if (id) {
				var sender = this.chunkSenders[id];
				if (!sender) {
					throw new RangeError('Invalid message id');
				}
				
				sender.abort();
			} else {
				for (id in this.chunkSenders) {
					this.chunkSenders[id].abort();
				}
			}
			// Cleanup will happen when the next chunk is sent/report is received
		};

		/**
		 * Closes the session. Further messages received for this session will be
		 * rejected.
		 */
		this.close = function() {
			this.abortReceive();
			this.abortSend();
		};

		this.onIncomingSend = function(req) {
			var msgId, description = null, filename = null, size = -1, chunkReceiver,
                    data, bytes, mime, ab, uia, i;
			var sessionType = this.con.chunkManager.sipmsrp.comm.type;
			console.log("session.onIncomingSend(). session type: " + sessionType);
            
            req.isBase64 = false;
            if (typeof req.body === 'string') {
            	if (typeof req.contentTransferEncoding === 'string' && req.contentTransferEncoding.toLowerCase() === 'base64') {
            		req.isBase64 = true;
            	} else if((/data:.*;base64/).test(req.body)) {
            		req.isBase64 = true;
                    console.log("onIncomingSend() -- found base64");
            	}
            }
			
    		if (req.byteRange.start === 1 && req.contentType && req.contentType.match(/message\/cpim/i)) {
    			CrocMSRP.parseCPIMMessage(req);
    		}
    		
			try {
				if (req.byteRange.start === 1 &&
						req.continuationFlag === CrocMSRP.Message.Flag.end) {
					// Non chunked message, but check whether it is an empty 'ping'
					if (req.body) {
						// Complete non-chunked, non-empty message

						// These are not required to have a Message-ID; create
						// one if it is not provided.
						msgId = req.messageId || CrocMSRP.util.newMID();
						size = req.byteRange.total;

						if (req.contentDisposition &&
								(req.contentDisposition.type === 'attachment' ||
								req.contentDisposition.type === 'render')) {
							// File transfer, extract any extra details
							description = req.getHeader('content-description');
							filename = req.contentDisposition.param.filename;
						}
                        
                        data = req.body;
                        if (req.isBase64) {
                            bytes = decodeURIComponent(escape(atob(data.split(',')[1])));
                            mime = data.slice(data.indexOf(':') + 1, data.indexOf(';'));
                            data = new Blob([bytes]);
                            //ab = new ArrayBuffer(bytes.length);
                            //uia = new Uint8Array(ab);
                            //for (i = 0; i < bytes.length; i++) {
                            //    uia[i] = bytes.charCodeAt(i);
                            //}
                            //data = new Blob([ab], {type: mime || req.contentType});
                        } else if (typeof data === 'string' && (sessionType === 'FileTransfer' || sessionType === 'ImageShare')) {
                            ab = new ArrayBuffer(data.length);
                            uia = new Uint8Array(ab);
                            for (i = 0; i < data.length; i++) {
                                uia[i] = data.charCodeAt(i);
                            }
                            data = new Blob([ab], {type: req.contentType});
                        }

						// Fire the appropriate event handlers
						this.eventObj.onFirstChunkReceived(msgId, req.contentType,
								filename, size, description);
						if (this.eventObj.onChunkReceived) {
							this.eventObj.onChunkReceived(msgId, size);
						}
						this.eventObj.onMessageReceived(msgId, req.contentType,
								data);
					}
				} else {
					// Chunk of a multiple-chunk message
					msgId = req.messageId;
					if (!msgId || !(msgId instanceof String || typeof msgId === 'string')) {
						sendResponse(req, this.con, this.localUri, CrocMSRP.Status.BAD_REQUEST);
						return;
					}
					
					if (req.byteRange.start === 1 &&
							req.continuationFlag === CrocMSRP.Message.Flag.continued) {
						// First chunk
						chunkReceiver = new CrocMSRP.ChunkReceiver(req, this.config.recvBuffer);

						if (req.contentDisposition &&
								(req.contentDisposition.type === 'attachment' ||
								req.contentDisposition.type === 'render')) {
							// File transfer, extract any extra details
							description = req.getHeader('content-description');
							filename = req.contentDisposition.param.filename;
						}

						// The following may throw an UnsupportedMedia exception
						this.eventObj.onFirstChunkReceived(msgId, req.contentType,
							filename, req.byteRange.total, description);

						// The application has not rejected it, so add it to the list of
						// current receivers.
						this.chunkReceivers[msgId] = chunkReceiver;
						
						// Kick off the chunk receiver poll if it's not already running
						if (!this.receiverCheckInterval) {
							var session = this;
							this.receiverCheckInterval = setInterval(
								function() {
									checkReceivers(session);
								}, 1000
							);
						}
					} else {
						// Subsequent chunk
						chunkReceiver = this.chunkReceivers[msgId];
						if (!chunkReceiver) {
							// We assume we will receive chunk one first
							// We could allow out-of-order, but probably not worthwhile
							sendResponse(req, this.con, this.localUri, CrocMSRP.Status.STOP_SENDING);
							return;
						}
                        
                        if (chunkReceiver.firstChunk.isBase64) {
                            // If the first chunk was base64, the others will be too
                            req.isBase64 = true;
                        }
						
						if (!chunkReceiver.processChunk(req)) {
							// Message receive has been aborted
							delete this.chunkReceivers[msgId];

							if (chunkReceiver.remoteAbort) {
								// TODO: what's the appropriate response to an abort?
								sendResponse(req, this.con, this.localUri, CrocMSRP.Status.STOP_SENDING);
							} else {
								// Notify the far end of the abort
								sendResponse(req, this.con, this.localUri, CrocMSRP.Status.STOP_SENDING);
							}

							// Notify the application of the abort
							try {
								this.eventObj.onMessageReceiveAborted(msgId, chunkReceiver.blob);
							} catch (e) {
								console.warn('Unexpected application exception: ' + e.stack);
							}

							return;
						}
					}
						
					//Raju
					console.log("chunkReceiver.size "+ chunkReceiver.size +". chunkReceiver.totalBytes " + chunkReceiver.totalBytes) ;
					if (chunkReceiver.isComplete()) {
						delete this.chunkReceivers[msgId];
						var blob = chunkReceiver.blob;
						if (this.eventObj.onChunkReceived) {
							this.eventObj.onChunkReceived(msgId, chunkReceiver.size);
						}
						this.eventObj.onMessageReceived(msgId, blob.type, blob);
					} else {
						// Receive ongoing
						if (this.eventObj.onChunkReceived) {
							this.eventObj.onChunkReceived(msgId, chunkReceiver.receivedBytes);
						}
					}
				}
			} catch (e) {
				// Send an error response, but check which status to return
				var status = CrocMSRP.Status.INTERNAL_SERVER_ERROR;
				if (e instanceof CrocMSRP.Exceptions.UnsupportedMedia) {
					status = CrocMSRP.Status.UNSUPPORTED_MEDIA;
				} else {
					console.warn('Unexpected application exception: ' + e.stack);
				}
				sendResponse(req, this.con, this.localUri, status);
				return;
			}

			// Send success response
			sendResponse(req, this.con, this.localUri, CrocMSRP.Status.OK);
			
			// Send REPORT if requested
			if (req.getHeader('success-report') === 'yes') {
				sendReport(this, req);
			}
		};
		
		this.onIncomingReport = function(report) {
			var msgId, sender;

			msgId = report.messageId;
			if (!msgId) {
				console.log('Invalid REPORT: no message id');
				return;
			}
			
			// Check whether this is for a chunk sender first
			sender = this.chunkSenders[msgId];
			if (!sender) {
				console.log('Invalid REPORT: unknown message id');
				// Silently ignore, as suggested in 4975 section 7.1.2
				return;
			}

			// Let the chunk sender handle the report
			sender.processReport(report);
			if (!sender.isComplete()) {
				// Still expecting more reports, no notification yet
				return;
			}
			
			// All chunks have been acknowledged; clean up
			delete this.chunkSenders[msgId];

			// Don't notify for locally aborted messages
			if (sender.aborted && !sender.remoteAbort) {
				return;
			}
			
			// Notify the application
			try {
				if (report.status === CrocMSRP.Status.OK) {
					if (this.eventObj.onMessageDelivered) {
						this.eventObj.onMessageDelivered(msgId);
					}
				} else {
					this.eventObj.onMessageSendFailed(msgId, report.status, report.comment, sender.bodyText);
				}
			} catch (e) {
				console.warn('Unexpected application exception: ' + e.stack);
			}
		};
		
		this.onIncomingResponse = function(resp) {
			var msgId;

            // AUTH method removed, as it is not needed
			
			// Otherwise it's a SEND response
			msgId = resp.request.getHeader('message-id');
			if (!msgId) {
				console.log('Can\'t retrieve SEND message id');
				return;
			}

			var sender = resp.request.sender;
			if (resp.status === CrocMSRP.Status.OK) {
				try {
					if (!sender.aborted && this.eventObj.onChunkSent) {
						this.eventObj.onChunkSent(msgId, resp.request.byteRange.end);
					}

					if (resp.request.continuationFlag === CrocMSRP.Message.Flag.end &&
							this.eventObj.onMessageSent) {
						// Notify the application
						this.eventObj.onMessageSent(msgId);
					}
				} catch (e) {
					console.warn('Unexpected application exception: ' + e.stack);
				}
			} else {
                var content = undefined;
                if (this.chunkSenders[msgId]) {
                    content = this.chunkSenders[msgId].bodyText;
                }
				// Failure response
				sender.abort();
				sender.remoteAbort = true;
				// Don't expect any more REPORTs
				delete this.chunkSenders[msgId];
				// Sender will be removed from Connection.activeSenders later

				// Notify the application
				try {
					this.eventObj.onMessageSendFailed(msgId, resp.status, resp.comment, content);
				} catch (e) {
					console.warn('Unexpected application exception: ' + e.stack);
				}
			}
		};
		
		// Private functions
		function makeTimeoutHandler(session, msgId) {
			return function() {
                var content = undefined;
                if (session.chunkSenders[msgId]) {
                    content = session.chunkSenders[msgId].bodyText;
                }
				delete session.chunkSenders[msgId];
				// Notify the application
				try {
					session.eventObj.onMessageSendFailed(msgId, CrocMSRP.Status.REQUEST_TIMEOUT, 'Report Timeout', content);
				} catch (e) {
					console.warn('Unexpected application exception: ' + e.stack);
				}
			};
		}
		
		function sendResponse(req, con, uri, status) {
			if (status === CrocMSRP.Status.OK) {
				if (!req.responseOn.success) {
					return;
				}
			} else {
				if (!req.responseOn.failure) {
					return;
				}
			}
			
			con.ws.send(new CrocMSRP.Message.OutgoingResponse(req, uri, status));
		}
		
		function sendReport(session, req) {
			var report;
			
			report = new CrocMSRP.Message.OutgoingRequest(session, 'REPORT');
			report.addHeader('message-id', req.messageId);
			report.addHeader('status', '000 200 OK');

			if (req.byteRange ||
					req.continuationFlag === CrocMSRP.Message.Flag.continued) {
				// A REPORT Byte-Range will be required
				var start = 1, end, total = -1;
				if (req.byteRange) {
					// Don't trust the range end
					start = req.byteRange.start;
					total = req.byteRange.total;
				}
				if (!req.body) {
					end = 0;
				} else if (req.body instanceof ArrayBuffer) {
					console.log("sendReport. req.body is ArrayBuffer") ;
					// Yay! Binary frame: the length is obvious.
					end = start + req.body.byteLength - 1;
				} else if (req.isBase64) {
					console.log("sendReport. req.body is base64") ;
                    // Base64 string. Assume one byte per character.
                    end = start + req.body.length - 1;
                } else {
					console.log("sendReport. req.body is String") ;
					// Boo. Text frame: turn it back into UTF-8 and cross your fingers
					// that the resulting bytes (and length) are what they should be.
					var blob = new Blob([req.body]);
					end = start + blob.size - 1;
					// blob.close();
				}
				
				if (end !== req.byteRange.end) {
					//Raju
					console.warn("Report Byte-Range end does not match request. end:" + end + ",req.byteRange.end:" + req.byteRange.end );
				}
				
				report.byteRange = {'start': start, 'end': end, 'total': total};
			}
			session.con.ws.send(report);
		}
		
		function checkReceivers(session) {
			var msgId, receiver,
				now = new Date().getTime(),
				timeout = session.config.chunkTimeout;
			for (msgId in session.chunkReceivers) {
				receiver = session.chunkReceivers[msgId];
				console.log("now: " + now + ", lastReceive: " + receiver.lastReceive + ", timeout: " + timeout);
				if (now - receiver.lastReceive > timeout) {
					// Clean up the receiver
					receiver.abort();
					delete session.chunkReceivers[msgId];
					try {
						session.eventObj.onMessageReceiveTimeout(msgId, receiver.blob);
					} catch (e) {
						console.warn('Unexpected application exception: ' + e.stack);
					}
				}
			}
			
			if (CrocMSRP.util.isEmpty(session.chunkReceivers)) {
				clearInterval(session.receiverCheckInterval);
				session.receiverCheckInterval = null;
			}
		}

		//End of Session
	}

	/**
	* Light version of CrocMSRP.Connection
	*/
	function Connection(chunkManager) {
        this.chunkManager = chunkManager;
		this.config = new CrocMSRP.ConnectionConfig();
		this.ws = null;
		this.localSessionIds = {};
		this.reconnectTimer = null;
        this.reducedChunkSize = 512; // default is 2048. TODO: Change default to 1000 to deal avoid fragmentation etc.
        this.bandwidthDelay = 200; // if bandwidth limit is hit, wait this many milliseconds before retry
        this.bandwidthRetries = 5; // if bandwidth limit is hit, retry up to this many times
        this.ramp = 2; // original value is 2, but for RTP datachannel try 1. Change back to 2 to speed up the transfer.
		
		// An array of active message senders
		this.activeSenders = [];
		// The count of outstanding sends
		this.outstandingSends = 0;

		this.onMsrpRequest = function(req) {
			var toUri, session;
			
			// The request's To-Path should have only one URI, and that URI should
			// correspond to one of our sessions.
			if (req.toPath.length !== 1) {
				sendResponse(req, this, req.toPath[0], CrocMSRP.Status.SESSION_DOES_NOT_EXIST);
				return;
			}
			// Decode the URI
			toUri = new CrocMSRP.Uri(req.toPath[0]);
			if (!toUri) {
				sendResponse(req, this, req.toPath[0], CrocMSRP.Status.BAD_REQUEST);
				return;
			}
			// Lookup the appropriate session
			session = this.localSessionIds[toUri.sessionId];
			if (!session || !(session.localUri.authority === toUri.authority) || !(session.localUri.port === toUri.port) || !(session.localUri.sessionId === toUri.sessionId)) {
				sendResponse(req, this, req.toPath[0], CrocMSRP.Status.SESSION_DOES_NOT_EXIST);
				return;
			}

			// Check the request method
			switch (req.method) {
			case 'SEND':
				session.onIncomingSend(req);
				break;
			case 'REPORT':
				session.onIncomingReport(req);
				break;
			default:
				// Unknown method; return 501 as specified in RFC 4975 section 12
				sendResponse(req, this, req.toPath[0], CrocMSRP.Status.NOT_IMPLEMENTED);
				return;
			}
		};
		
		this.addSender = function(sender) {
			this.activeSenders.push(sender);
			sendRequests(this);
		};
		
		this.onMsrpResponse = function(res) {
			if (res.request.method === 'SEND') {
				this.outstandingSends--;
			}
			
			// Let the sending session handle the response
			res.request.session.onIncomingResponse(res);
			
			// Then send out any pending requests
			sendRequests(this);
		};

		// Private functions

		function sendResponse(req, con, uri, status) {
			if (status === CrocMSRP.Status.OK) {
				if (!req.responseOn.success) {
					return;
				}
			} else {
				if (!req.responseOn.failure) {
					return;
				}
			}
			
			con.ws.send(new CrocMSRP.Message.OutgoingResponse(req, uri, status));
		}

		function sendRequests(con, sent) {
			var sender, msg, e, retries, interval;
			if (!sent) {
				sent = 0;
			}

			// If there are outstanding transfers, send up to N further requests.
			// This lets us ramp up the outstanding requests without locking up the
			// application.
			// (Use while loop for synchronous functions, recursion for asynchronous.)
			while (con.activeSenders.length > 0 &&
					con.outstandingSends < con.config.maxOutstandingSends &&
					sent < con.ramp) {
				sender = con.activeSenders[0];
				if (sender.aborted && sender.remoteAbort) {
					// Don't send any more chunks; remove sender from list
					con.activeSenders.shift();
				}

				con.outstandingSends++;
				sent++;
				con.chunkManager.totalSize = sender.size;
				msg = sender.getNextChunk();
				e = con.ws.send(msg);
				if (e === true || sender.aborted) {
					checkSenderCompleteness(con, sender);
					// stay in while loop
				} else {
					// The chunk failed to go through datachannel, so try alternate methods
					if (e === 'BlobForbidden' && msg.byteRange.start === 1) {
						// This DataChannel does not allow sending of Blobs.
						// Modify the sender to send base64 string content.
						makeBase64Sender(sender, function (sender) {
								var msg, e;
								console.log('sendRequests: Trying again with base64 data');
								con.chunkManager.totalSize = sender.size;
								msg = sender.getNextChunk();
								e = con.ws.send(msg);
								if (e === 'OtherError') {
								// Chunk size might be too large for the bandwidth limit.
								// RTP DataChannel is rate limited at about 3 kbps, SCTP at about 64kbps.
								// Reboot the sender with a smaller chunk size.
								sender.config.chunkSize = con.reducedChunkSize;
								sender.session.config.chunkSize = con.reducedChunkSize;
								makeBase64Sender(sender, function (sender) {
									console.log('sendRequests: Trying again with reduced chunk size');
									var msg = sender.getNextChunk();
									con.ws.send(msg);
									checkSenderCompleteness(con, sender);
									sendRequests(con, sent);
									});
								return;
								}
								if (e !== true) {
									console.warn('Unexpected result from WSWrapper.send: ' + e);
								}
								checkSenderCompleteness(con, sender);
								sendRequests(con, sent);
						});
						return;
					}
					if (e === 'OtherError') {
						// Might have sent too fast for the bandwidth limit. Wait a bit and retry.
						retries = 0;
						interval = setInterval(function () {
								retries += 1;
								if (con.ws.send(msg) !== 'OtherError' || retries >= con.bandwidthRetries) {
								clearInterval(interval);
								checkSenderCompleteness(con, sender);
								sendRequests(con, sent);
								return;
								}
								}, con.bandwidthDelay);
						return;
					}
					console.warn('Unexpected result from WSWrapper.send: ' + e);
					checkSenderCompleteness(con, sender);
					// stay in while loop
				}
			}

			//End of sendRequests
		}
        
        function checkSenderCompleteness(con, sender) {
            // Check whether this sender has now completed
            if (sender.isSendComplete()) {
                // Remove this sender from the active list
                con.activeSenders.shift();
            } else if (con.activeSenders.length > 1) {
                // For fairness, move this sender to the end of the queue
                con.activeSenders.push(con.activeSenders.shift());
            }
        }
        
	function makeBase64Sender(sender, onReady) {
		// Modify a ChunkSender to use base64. Assume no bytes have been successfully sent, so we can reset.

		// Reset to initial state
		sender.sentBytes = 0;
		sender.ackedBytes = 0;
		sender.incontiguousReports = {};
		sender.incontiguousReportCount = 0;
		sender.reportTimer = null;
		sender.aborted = false;
		sender.remoteAbort = false;

		// Modify code to add header Content-Transfer-Encoding: base64
		sender.getNextChunk = function () {
			var chunk;

			chunk = new CrocMSRP.Message.OutgoingRequest(this.session, 'SEND');
			chunk.sender = this;
			chunk.addHeader('message-id', this.messageId);
			chunk.addHeader('success-report', 'yes');
			chunk.addHeader('failure-report', 'yes');

			if (this.aborted) {
				chunk.continuationFlag = CrocMSRP.Message.Flag.abort;
			} else {
				var start = this.sentBytes + 1,
				    //Raju:
				    end = Math.min(this.sentBytes + this.config.chunkSize, this.size);
				    //end = Math.min(this.sentBytes + 800, this.size);
				chunk.byteRange = {'start': start, 'end': end, 'total': this.size};

				if (this.size > 0) {
					if (this.sentBytes === 0) {
						// Include extra MIME headers on first chunk
						if (this.disposition) {
							chunk.addHeader('content-disposition', this.disposition);
						} else {
							chunk.addHeader('content-disposition', 'inline');
						}
						if (this.description) {
							chunk.addHeader('content-description', this.description);
						}
						if (typeof this.bodyText !== 'string') {
							// Indicate base64 encoding
							chunk.addHeader('content-transfer-encoding', 'base64');
						}
					}

					chunk.contentType = this.contentType;
					//Raju
					console.debug("Slicing the blob for next chunk at from " + this.sentBytes + "-" + end) ;
					chunk.body = this.blob.slice(this.sentBytes, end);
				}

				if (end < this.size) {
					chunk.continuationFlag = CrocMSRP.Message.Flag.continued;
				} else if (this.onReportTimeout) {
					var sender = this;
					this.reportTimer = setTimeout(function() {
							sender.onReportTimeout();
							sender.reportTimer = null;
							}, this.config.reportTimeout);
				}
				this.sentBytes = end;
			}

			return chunk;
		};

		// /.*[\u4e00-\u9fa5]+.*$/.test() is check whether there are chinese characters
		if (typeof sender.bodyText === 'string' && !(/.*[\u4e00-\u9fa5]+.*$/.test(sender.bodyText))) {
			// Keep plain text as is
			sender.blob = sender.bodyText;
			sender.size = sender.blob.length;
			onReady(sender);
		} else if(typeof sender.blob === 'string' && !(/.*[\u4e00-\u9fa5]+.*$/.test(sender.blob))){
			sender.size = sender.blob.length;
			onReady(sender);
		} else {
			// Convert Blob content to base64 for binary data or string containing Chinese characters
			var reader = new window.FileReader();
			reader.readAsDataURL(sender.blob);
			reader.onload = function (event) {
				sender.blob = event.target.result; // This is now a base64 string instead of a Blob
				sender.size = sender.blob.length; // Assume one byte per character in base64
				if (typeof onReady === 'function') {
					onReady(sender);
				}
			}
		}

		//End of makeBase64Sender
	}

		//End of Connection
	}

	/**
	* Light version of CrocMSRP.WSWrapper
	*/
	function WSWrapper(con, sipmsrp) {
		this.con = con;
		this.sipmsrp = sipmsrp;
		// Object for tracking outstanding transaction IDs (for sent requests)
		this.transactions = {};
		this.msrpBuffer = "" ;

		this.send = function(message, overridePayload) {
			var wsWrapper = this, msg, cordova, filereader;
			
			if (message instanceof CrocMSRP.Message.Request && message.method !== 'REPORT') {
				//Raju: move it to successful send case only
				//message.timer = setTimeout(function(){timeout(wsWrapper, message);}, 30000);
				//this.transactions[message.tid] = message;
				//console.debug("Timer for transaction '" +  message.tid + "' set") ;
			}
			
			if (overridePayload) {
				msg = overridePayload;
			} else {
				msg = message.encode();
				cordova = window.cordova;
				if (cordova && cordova.plugins && cordova.plugins.iosrtc && msg instanceof Blob) {
					console.log('iosrtc plugin does not allow send Blob. convert to ArrayBuffer.');
					filereader = new FileReader();
					filereader.onload = function () {
						wsWrapper.send(message, this.result);
					};
					filereader.readAsArrayBuffer(msg);
					return true;
				}
			}
			try {
				this.sipmsrp.comm.wrappedCall.sendMessage(msg);
				//this.ws.send(message.encode());
				//Raju: Now set the transaction for req only
				if(message.method == 'SEND') {
					message.timer = setTimeout(function(){timeout(wsWrapper, message);}, 30000);
					this.transactions[message.tid] = message;
					console.debug("Timer for transaction '" +  message.tid + "' set") ;
				}
			} catch (e) {
                console.log("Could not send through DataChannel. Error: " + e);
                if (e.toString().indexOf('Blob') > -1) {
                    return 'BlobForbidden';
                } else {
                    return 'OtherError';
                }
			}
			
			return true;
		};
		
		this.onMessage = function(msg) {

			// Raju: Begin
			// concatenate buffer message messages
			//console.debug("this.msrpBuffer :'" + this.msrpBuffer + "'") ;
			this.msrpBuffer = this.msrpBuffer+msg ;  

			while (this.msrpBuffer != "") {
				var endIndex, firstLine, tokens, chunkEndIndex, transId ;
				// get transaction id
				//MSRP 75u2kd3r SEND
				endIndex = this.msrpBuffer.indexOf('\r\n');
				if (endIndex <= 0) {
					console.debug("partial MSRP message-no first line: this.msrpBuffer does not have 1st MSRP line yet.. wait for more data:'" + this.msrpBuffer + "'" + "this.msrpBuffer.length: " + this.msrpBuffer.length + "orcaDataChannel index:" + this.msrpBuffer.indexOf("orcaDataChannel")) ;
					//if(this.msrpBuffer.indexOf("orcaDataChannel") == 0) {
					
					// Raju: HACK!. message with value 'orcaDataChannel' seems to be a sideeffec tof failed send with binary non-base64 data.
					if(this.msrpBuffer.length == 27) {
						console.debug("Ignoring 'orcaDataChannel' MSRP chunk!!") ;
						this.msrpBuffer = ""
					}

					return ;
				}
	
				firstLine = this.msrpBuffer.substring(0, endIndex);
				tokens = firstLine.split(' ');
				if (tokens.length < 3 || tokens[0] !== 'MSRP' ||
						tokens[1].length === 0 || tokens[2].length === 0) {
					console.log('Error parsing message: unexpected first line format: ' + firstLine);
					return ;
				}

				transId = tokens[1] ;
				//console.debug("Looking for transId " + transId) ;
				//-------75u2kd3r+
				chunkEndIndex = this.msrpBuffer.indexOf("-------" + transId) ;
				console.debug("chunkEndIndex: " + chunkEndIndex);
				if (chunkEndIndex < 0) {
					console.debug("partial MSRP message: End of chunk NOT found for transaction " + transId + " wait for more data") ;
					return ;
				}

				//console.debug("End of chunk found for transaction " + transId + " at " + chunkEndIndex) ;
				chunkEndIndex = chunkEndIndex+transId.length+10 ; // 7 for "-------", 1 for "+ or $ or #", 2 for "\r\n"

				msg = this.msrpBuffer.substring(0, chunkEndIndex); 
				this.msrpBuffer = this.msrpBuffer.substring(chunkEndIndex) ; // until end

				if(msg.length > 0) {
					console.debug("processing new MSRP chunk " + msg) ;
				}

				if(this.msrpBuffer.length > 0) {
					console.debug("partial MSRP msg remaining in this.msrpBuffer '" + this.msrpBuffer + "'") ;
				}
				// Parse MSRP message
				var msg = CrocMSRP.parseMessage(msg);
				if (!msg) {
					console.warn('Parsing error on incoming message. Ignoring message.');
					return;
				}
				
				if (msg instanceof CrocMSRP.Message.Response) {
					// Check for outstanding transaction
					msg.request = this.transactions[msg.tid];
					if (msg.request) {
						console.debug("Clearing timeout for transaction '" +  msg.tid + "'") ;
						clearTimeout(msg.request.timer);
						delete msg.request.timer;
						delete this.transactions[msg.tid];
						this.con.onMsrpResponse(msg);
					} else {
						console.log("Unexpected response received; not in transaction list");
					}
					return;
				}
				
				// Send requests up to the con
				this.con.onMsrpRequest(msg);
			} // while
			// Raju: End
		};

		function timeout(wsWrapper, request) {
			//Raju
			console.error("timeout happened for transaction request.tid: " + request.tid) ;
			delete request.timer;
			delete wsWrapper.transactions[request.tid];
			var resp = new CrocMSRP.Message.IncomingResponse(request.tid, 408, CrocMSRP.StatusComment[408]);
			resp.request = request;
			wsWrapper.con.onMsrpResponse(resp);
		}

		//End of WSWrapper
	}

	orcaALU.SipMsrp = SipMsrp;
	if (orcaALU.SipAdapter) {
		orcaALU.SipAdapter.Msrp = orcaALU.SipMsrp;
	}
})();
