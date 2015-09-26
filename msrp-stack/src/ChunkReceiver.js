/*
 * Copyright (c) 2013 Alcatel-Lucent
 *
 * Contains ALU modifications on crocodile-msrp 1.0.0
 *
 */


var CrocMSRP = (function(CrocMSRP) {

	/**
	 * Creates a new ChunkReceiver object to handle an incoming chunked message.
	 * @class Tracks and combines the received components of a chunked message.
	 * @param {CrocMSRP.Message.Request} firstChunk The first received chunk:
	 * this must contain the first byte of the incoming message. Later chunks
	 * may arrive out-of-order.
	 * @param {Number} bufferSize The threshold of data to cache in memory
	 * writing the chunks out to a Blob (which will generally get stored to
	 * disk).
	 * @private
	 */
	CrocMSRP.ChunkReceiver = function(firstChunk, bufferSize) {
		if (!firstChunk || !firstChunk instanceof CrocMSRP.Message.Request) {
			throw new TypeError('Missing or unexpected parameter');
		}
		
		this.firstChunk = firstChunk;
		
		// totalBytes may be -1 if we don't know the size
		this.totalBytes = firstChunk.byteRange.total;
		this.bufferedChunks = [];
		this.bufferedBytes = 0;
		this.bufferSize = bufferSize;
		// blob contains all the contiguous message bodies we have received
		this.blob = new Blob();
		// Current blob size; cached since blob.size seems to be slow
		this.size = 0;
		// receivedBytes may be > totalBytes if we've had duplicate chunks
		this.receivedBytes = 0;
		this.aborted = false;  // true if the transfer has been aborted
		this.remoteAbort = false;  // true if the remote end aborted
		this.incontiguousChunks = {};
		this.isFile = firstChunk.contentDisposition &&
			(firstChunk.contentDisposition.type === 'attachment' ||
				firstChunk.contentDisposition.type === 'render');
		this.processChunk(firstChunk);
	};

	/**
	 * Processes subsequent chunks of the message as they arrive.
	 * @param {CrocMSRP.Message.Request} chunk The received chunk. This must be
	 * a chunk of the same message (i.e. the Message-ID must match that of the
	 * first chunk).
	 * @returns {Boolean} True if the chunk was successfully handled, false
	 * if the transfer should be aborted.
	 * @private
	 */
	CrocMSRP.ChunkReceiver.prototype.processChunk = function(chunk) {
		var chunkBody, chunkSize,
			nextStart = this.size + this.bufferedBytes + 1;
		
		if (this.aborted) {
			// The message has been aborted locally, or we've received another
			// chunk of a remote-aborted message; return error.
			return false;
		}
		
		if (chunk.messageId !== this.firstChunk.messageId) {
			console.error('Chunk has wrong message ID!');
			return false;
		}
		
		this.lastReceive = new Date().getTime();
		console.log("Chunk receiver's processChunk() lastReceive: " + this.lastReceive);

		if (chunk.body instanceof ArrayBuffer) {
			// Yay! Binary frame, everything is straightforward.
			// Convert to ArrayBufferView to avoid Chrome Blob constructor warning
			// This should not be necessary: https://bugs.webkit.org/show_bug.cgi?id=88389
			chunkBody = new Uint8Array(chunk.body);
			chunkSize = chunkBody.byteLength;
		//ALU start
		} else if (chunk.isBase64) {
            // Base64 string
			chunkBody = chunk.body;
			chunkSize = chunkBody.length;
		//ALU end
		} else {
			// Boo. Text frame: turn it back into UTF-8 and cross your fingers
			// that the resulting bytes are what they should be.
			//Raju: Keep the converted binary string as is, will be converted to Blob at the end 
			//chunkBody = new Blob([chunk.body]);
			//chunkSize = chunkBody.size;
			chunkBody = chunk.body ;
			chunkSize = chunkBody.length;

		}
		this.receivedBytes += chunkSize;

		switch (chunk.continuationFlag) {
		case CrocMSRP.Message.Flag.continued:
			break;
		case CrocMSRP.Message.Flag.end:
			this.totalBytes = chunk.byteRange.start + chunkSize - 1;
			break;
		case CrocMSRP.Message.Flag.abort:
			this.abort();
			this.remoteAbort = true;
			return false;
		}

		if (chunk.byteRange.start === nextStart) {
			console.debug("contigous chunk : " + nextStart) ;
			// This is the expected result; append to the write buffer
			this.bufferedChunks.push(chunkBody);
			this.bufferedBytes += chunkSize;
			nextStart += chunkSize;
			
			// Check whether there are any incontiguous chunks we can now append
			while (!CrocMSRP.util.isEmpty(this.incontiguousChunks)) {
				var nextChunk = this.incontiguousChunks[nextStart];
				if (!nextChunk) {
					// There's a gap: stop appending
					break;
				}
				delete this.incontiguousChunks[nextStart];
				
				// Add it to the disk buffer
				this.bufferedChunks.push(nextChunk);
				if (nextChunk instanceof ArrayBuffer) {
					chunkSize = nextChunk.byteLength;
				} else {
					chunkSize = nextChunk.size;
					if (chunkSize === undefined) {
						chunkSize = nextChunk.length;
					}
				}
				this.bufferedBytes += chunkSize;
				nextStart += chunkSize;
			}
			
			// Write out to the blob if we've exceeded the buffer size, or the
			// transfer is complete
			if (this.bufferedBytes >= this.bufferSize ||
					this.size + this.bufferedBytes === this.totalBytes) {
				console.debug("Buffer full or end reached") ; 
				writeToBlob(this);
			}
		} else if (chunk.byteRange.start > nextStart) {
			console.debug("incontiguousChunks chunk start " + chunk.byteRange.start + ", nextStart: " + nextStart) ;
			// Add this chunk to the map of incontiguous chunks
			this.incontiguousChunks[chunk.byteRange.start] = chunkBody;
		} else {
			// Duplicate chunk: RFC 4975 section 7.3.1 paragraph 3 suggests
			// that the last chunk received SHOULD take precedence.
			var array = [];
			
			// Write out the buffer in case the new chunk overlaps
			//Raju
			console.debug("duplicate chunk received start " + chunk.byteRange.start + ", nextStart: " + nextStart) ;
			writeToBlob(this);
			
			// Construct a new blob from this chunk plus appropriate slices
			// of the existing blob.
			if (chunk.byteRange.start > 1) {
				array.push(this.blob.slice(0, chunk.byteRange.start - 1));
			}
			array.push(chunkBody);
			if (chunk.byteRange.start + chunkSize <= this.size) {
				array.push(this.blob.slice(chunk.byteRange.start + chunkSize - 1));
			}
			
            //ALU start
            if (chunk.isBase64) {
                this.blob = array.join('');
                this.size = this.blob.length;
            } else {
                this.blob = new Blob(array, {type: this.firstChunk.contentType});
                this.size = this.blob.size;
            }
            //ALU end
		}
		
		return true;
	};

	/**
	 * Checks whether all expected chunks have been received.
	 * @returns {Boolean} True if all chunks have been received, or if the
	 * message has been aborted. False if we still expect further chunks.
	 * @private
	 */
	CrocMSRP.ChunkReceiver.prototype.isComplete = function() {
		return this.aborted || (this.size === this.totalBytes);
	};
	
	/**
	 * Requests that we abort this incoming chunked message. An appropriate
	 * error will be returned when we receive the next chunk.
	 * @private
	 */
	CrocMSRP.ChunkReceiver.prototype.abort = function() {
		this.aborted = true;
	};
	
	function writeToBlob(receiver) {
		//ALU start
		var data, bytes, mime, ab, uia, i, base64String;
        //ALU end
//		if (receiver.size > 0) {
//			receiver.bufferedChunks.unshift(receiver.blob);
//            receiver.size = receiver.blob.size;
//		}
        //ALU start
		if (receiver.firstChunk.isBase64) {
            data = receiver.bufferedChunks.join('');
            console.log("data: " + data + "; type: " + typeof data);
        	//the first time when buffer is full, the message contains the header data:text/css;base64,
            stringArray = data.split(',');
            if (stringArray.length === 2) {
            	base64String = stringArray[1];
            } else {
            	base64String = stringArray[0];
            }
            base64StringLen = base64String.length;
            //Every 3 bytes is encoded as 4 bytes of base64 string. If a 4-byte is divided into 2 chunks, save the
            //imcomplted part to wait for the next chunk
            base64String4NextChunkLen = base64StringLen % 4;
            completeBase64StringLen = base64StringLen - base64String4NextChunkLen;
            base64StringToParse = base64String.slice(0, completeBase64StringLen);
            base64String4NextChunk = base64String.slice(completeBase64StringLen);
            
            bytes = atob(base64StringToParse);

            mime = data.slice(data.indexOf(':') + 1, data.indexOf(';'));
            ab = new ArrayBuffer(bytes.length);
            uia = new Uint8Array(ab);
            for (i = 0; i < bytes.length; i++) {
                uia[i] = bytes.charCodeAt(i);
            }
            newBlob = new Blob([ab], {type: mime || receiver.firstChunk.contentType});
            mergedBlob = new Blob([receiver.blob, newBlob]);
            receiver.blob = mergedBlob;
            receiver.size += data.length - base64String4NextChunkLen; //For progress tracking, this needs to be the size of the base64 string, not the Blob
    		
    		receiver.bufferedChunks = [];
    		receiver.bufferedChunks.push(base64String4NextChunk);
    		receiver.bufferedBytes = base64String4NextChunkLen;

		} else {
			//Raju
			
			data = receiver.bufferedChunks.join('');
			console.log("Writing received chunks to Blob. receiver.firstChunk.contentType " + receiver.firstChunk.contentType + ", size " + data.length) ;
			//receiver.blob = new Blob(receiver.bufferedChunks, {type: receiver.firstChunk.contentType});
			ab = new ArrayBuffer(data.length);
			uia = new Uint8Array(ab);
			for (i = 0; i < data.length; i++) {
				uia[i] = data.charCodeAt(i);
			}
			//data = new Blob([ab], {type: mime || req.contentType});
			// Prepend the old blob (could be empty initially) to the new chunks
			receiver.blob = new Blob([receiver.blob, ab], {type: receiver.firstChunk.contentType});
			receiver.size = receiver.blob.size;
			console.log("Writing received chunks to Blob. size: " + receiver.size) ;
			receiver.bufferedChunks = [];
			receiver.bufferedBytes = 0;
		}
		//ALU end
	}
	
	return CrocMSRP;
}(CrocMSRP || {}));

