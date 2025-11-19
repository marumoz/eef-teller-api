"use strict";

const path 					= require("path");
const fs       				= require ("fs");
const axios               	= require("axios");
const moment               	= require("moment");
const env    				= require( path.resolve("./env") );

const statusMessages 		= env.statusMessages;

const UtilitiesMixin        = require("../mixins/utilities.mixin");
const RedisCacheMixin       = require("../mixins/cache.mixin");

module.exports = {
	name: "receipt",
	settings: {
		log					: true,
		apiTimeout 			: 60000,
		appName             : "eef-teller-api",
		dataSources 		: {}
	},

	mixins: [ UtilitiesMixin, RedisCacheMixin ],

	actions: {
		printReceipt: {
			params: {
				//payload: "string"
			},
			async handler (ctx) {
				let { payload: reqData } = ctx.params;
				let { data: payload, publicKey } = this.aesDecrypt(reqData);
				//console.log('>>>>>>>>>>>>>>>>>>> PRINT RECEIPT',JSON.stringify({ payload, url: this.settings.dataSources['download-receipt'] }, null, 4))

				let feedback = {
					success: false,
					status: 99,
					message: statusMessages[99]
				};

				let logData        = {
					type 		: "info",
					action 		: payload["transactionType"],
					service 	: ctx.service.fullName,
					sent    	: "",
					requestParams: { ...payload },
					userDevice 	: ctx.meta.userDevice
				};
				//Failed decyption
				if(!payload){
					logData.response = feedback;
					logData.type = "error";
					logData.response = "Payload decryption failed";
					ctx.emit("create.log", logData);

					return {
						message: await this.aesEncrypt(feedback, publicKey)
					};
				}
				let dwldReceiptUrl = this.settings.dataSources["download-receipt"].split(" ").filter(e => e && e)[1];
				//handle base url
				if(!dwldReceiptUrl.startsWith("http") && this.settings.dataSources.baseURL){
					dwldReceiptUrl = `${this.settings.dataSources.baseURL}${dwldReceiptUrl}`;
				}

				let reqResponse = await this.sendRequest("post", dwldReceiptUrl, payload);

				//console.log({reqResponse})
				return reqResponse.data;

			}
		},

		mgReverseUploads: {
			async handler (ctx) {
				const { $multipart, fieldname, filename, mimetype } = ctx.meta;
				let { payload } = $multipart;
        
				let logData        = {
					type 		: "info",
					action 		: "mg-docs",
					service 	: ctx.service.fullName,
					requestParams: payload,
					userDevice 	: ctx.meta.userDevice
				};

				// console.log({ META: ctx.meta, Params: ctx.params, MultiPart: $multipart })

				const allowedTypes = [
					"application/pdf",
					"application/msword",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					"application/vnd.ms-excel",
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				];
                
				return new Promise ( ( resolve, reject ) => {		
					// Throw error if a disallowed mimeType is present
					if ( !allowedTypes.includes ( mimetype )){
						logData.type = "error";
						logData.feedback = `${mimetype} is Not allowed for ${payload} - ${fieldname} - ${filename}`;
						ctx.emit("create.log", logData);
                        
						reject (`${mimetype} is Not allowed for ${fieldname} - ${filename}`);
					}					
                    
					// make sure the filepath exists
					const fileDir  = path.resolve("./store/mgdocs/");
					const filePath = path.resolve(fileDir, filename);

					// write to the filepath
					const f = fs.createWriteStream(filePath);
					let attachments = [];
                    
					try {
						payload = JSON.parse(payload);
					} catch (error) { /* empty */ }
                    
					f.on("finish", async () => {
						attachments.push({
							"filename"   : `${payload.referenceNumber}${filename}`,
							"path"       : path.resolve(`./store/mgdocs/${filename}`),
							"contentType": mimetype
						});
                        
					});
					f.on ( "close", async () => {
        
						let FormData = require("form-data");
						let form_data = new FormData();

						form_data.append("message", JSON.stringify(payload));
						for (let i = 0; i < attachments.length; i++) {
							form_data.append(fieldname, fs.createReadStream(attachments[i].path));
						}

						const request_config = {
							"content-type": "multipart/form-data"
						};

						const https 				= require ("https");
						let httpsAgent  			= new https.Agent({ rejectUnauthorized: false });
						let mgDocsEndpoint 			= this.settings.dataSources["mg-uploads"];
						mgDocsEndpoint 				= mgDocsEndpoint.split(" ").filter(e => e && e)[1];
						let res 					= {};
						logData["sent"]    			= moment().format ( "YYYY-MM-DD HH:mm:ss:SSSS");
						logData["esb-endpoint"]    	= mgDocsEndpoint;
						//handle base url
						if(!mgDocsEndpoint.startsWith("http") && this.settings.dataSources.baseURL){
							mgDocsEndpoint = `${this.settings.dataSources.baseURL}${mgDocsEndpoint}`;
						}
                            
						try {
							let instance = mgDocsEndpoint.startsWith("https") ? axios.create ({ httpsAgent }) : axios.create();
							res = await instance.post(
								`${mgDocsEndpoint}`,
								form_data,
								{ headers: {
									...request_config,
									...form_data.getHeaders()
								}}
							);
						} catch (error) {
							console.error(error.message);
							res = error.response;
						}
						let feedback = res.data;

						//log types
						logData["received"] = moment().format ( "YYYY-MM-DD HH:mm:ss:SSSS");
						let sent            = moment ( logData.sent,"YYYY-MM-DD HH:mm:ss:SSSS"  ),
							received        = moment ( logData.received,"YYYY-MM-DD HH:mm:ss:SSSS" );
						logData.latency     = `${received.diff(sent, "milliseconds")} ms`;
						logData.type 		= feedback ? "info" : "debug";
						logData.clientResponse = feedback;
						ctx.emit("create.log", logData);

						resolve(feedback);
					});

					ctx.params.on ( "error", err => {
						reject({
							message: "File error received",
							success: false,
							filename: path.basename ( filePath ),
							location: `File error received -  ERROR: ${err.message}`
						});
						f.destroy(err);
					});

					f.on( "error", ( err ) => {
						console.error(`File error received -  ERROR: ${err.message}` );
						// Remove the errored file.
						fs.unlinkSync ( filePath );
					});

					ctx.params.pipe ( f );
				});
			}
		},

		altWithdrawalUploads: {
			async handler (ctx) {
				const { $multipart, fieldname, filename, mimetype } = ctx.meta;
				let { payload } = $multipart;
        
				let logData        = {
					type 		: "info",
					action 		: "alt-withdrawal-docs",
					service 	: ctx.service.fullName,
					requestParams: payload,
					userDevice 	: ctx.meta.userDevice
				};

				// console.log({ META: ctx.meta, Params: ctx.params, MultiPart: $multipart })

				const allowedTypes = [
					"application/pdf",
					"application/msword",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					"image/jpeg",
					"image/png"
				];
                
				return new Promise ( ( resolve, reject ) => {		
					// Throw error if a disallowed mimeType is present
					if ( !allowedTypes.includes ( mimetype )){
						logData.type = "error";
						logData.feedback = `${mimetype} is Not allowed for ${payload} - ${fieldname} - ${filename}`;
						ctx.emit("create.log", logData);
                        
						reject (`${mimetype} is Not allowed for ${fieldname} - ${filename}`);
					}					
                    
					// make sure the filepath exists
					const fileDir  = path.resolve("./store/cash-withdrawal/");
					const filePath = path.resolve(fileDir, filename);

					// write to the filepath
					const f = fs.createWriteStream(filePath);
					let attachments = [];
                    
					try {
						payload = JSON.parse(payload);
					} catch (error) { /* empty */ }
                    
					f.on("finish", async () => {
						attachments.push({
							"filename"   : `${payload.referenceNumber}`,
							"path"       : path.resolve(`./store/cash-withdrawal/${filename}`),
							"contentType": mimetype
						});
					});
					f.on ( "close", async () => {
        
						let FormData = require("form-data");
						let form_data = new FormData();
						const fileExtension = filename.split(".");

						form_data.append("message", JSON.stringify(payload));
						for (let i = 0; i < attachments.length; i++) {
							form_data.append(fieldname, fs.createReadStream(attachments[i].path), `${payload.referenceNumber}.${fileExtension[fileExtension.length - 1]}`);
						}

						const request_config = {
							"content-type": "multipart/form-data"
						};

						const https 				= require ("https");
						let httpsAgent  			= new https.Agent({ rejectUnauthorized: false });
						let uploadFileEndpoint 		= this.settings.dataSources["alt-withdrawal-uploads"];
						uploadFileEndpoint 			= uploadFileEndpoint.split(" ").filter(e => e && e)[1];
						let res 					= {};
						logData["sent"]    			= moment().format ( "YYYY-MM-DD HH:mm:ss:SSSS");
						logData["esb-endpoint"]    	= uploadFileEndpoint;
						//handle base url
						if(!uploadFileEndpoint.startsWith("http") && this.settings.dataSources.baseURL){
							uploadFileEndpoint = `${this.settings.dataSources.baseURL}${uploadFileEndpoint}`;
						}
                            
						try {
							let instance = uploadFileEndpoint.startsWith("https") ? axios.create ({ httpsAgent }) : axios.create();
							res = await instance.post(
								`${uploadFileEndpoint}`,
								form_data,
								{ headers: {
									...request_config,
									...form_data.getHeaders()
								}}
							);
						} catch (error) {
							console.error(error.message);
							res = error.response;
						}
						let feedback = res.data;

						//log types
						logData["received"] = moment().format ( "YYYY-MM-DD HH:mm:ss:SSSS");
						let sent            = moment ( logData.sent,"YYYY-MM-DD HH:mm:ss:SSSS"  ),
							received        = moment ( logData.received,"YYYY-MM-DD HH:mm:ss:SSSS" );
						logData.latency     = `${received.diff(sent, "milliseconds")} ms`;
						logData.type 		= feedback ? "info" : "debug";
						logData.clientResponse = feedback;
						ctx.emit("create.log", logData);

						resolve(feedback);
					});

					ctx.params.on ( "error", err => {
						reject({
							message: "File error received",
							success: false,
							filename: path.basename ( filePath ),
							location: `File error received -  ERROR: ${err.message}`
						});
						f.destroy(err);
					});

					f.on( "error", ( err ) => {
						console.error(`File error received -  ERROR: ${err.message}` );
						// Remove the errored file.
						fs.unlinkSync ( filePath );
					});

					ctx.params.pipe ( f );
				});
			}
		},

		registrationUploads: {
			async handler (ctx) {
				const { $multipart, fieldname, filename, mimetype } = ctx.meta;
				let { payload } = $multipart;
        
				let logData        = {
					type 		: "info",
					action 		: "registration-docs",
					service 	: ctx.service.fullName,
					requestParams: payload,
					userDevice 	: ctx.meta.userDevice
				};

				// console.log({ META: ctx.meta, Params: ctx.params, MultiPart: $multipart })

				const allowedTypes = [
					"application/pdf",
					"application/msword",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					"image/jpeg",
					"image/png"
				];
                
				return new Promise ( ( resolve, reject ) => {		
					// Throw error if a disallowed mimeType is present
					if ( !allowedTypes.includes ( mimetype )){
						logData.type = "error";
						logData.feedback = `${mimetype} is Not allowed for ${payload} - ${fieldname} - ${filename}`;
						ctx.emit("create.log", logData);
                        
						reject (`${mimetype} is Not allowed for ${fieldname} - ${filename}`);
					}					
                    
					// make sure the filepath exists
					const fileDir  = path.resolve("./store/customer-registration/");
					const filePath = path.resolve(fileDir, filename);

					// write to the filepath
					const f = fs.createWriteStream(filePath);
					let attachments = [];
                    
					try {
						payload = JSON.parse(payload);
					} catch (error) { /* empty */ }
                    
					f.on("finish", async () => {
						attachments.push({
							"filename"   : fieldname, //`${payload.referenceNumber}`,
							"path"       : path.resolve(`./store/customer-registration/${filename}`),
							"contentType": mimetype
						});
					});
					f.on ( "close", async () => {
        
						let FormData = require("form-data");
						let form_data = new FormData();
						const fileExtension = filename.split(".");

						form_data.append("message", JSON.stringify(payload));
						for (let i = 0; i < attachments.length; i++) {
							form_data.append(fieldname, fs.createReadStream(attachments[i].path), `${fieldname}.${fileExtension[fileExtension.length - 1]}`);
						}

						const request_config = {
							"content-type": "multipart/form-data"
						};

						const https 				= require ("https");
						let httpsAgent  			= new https.Agent({ rejectUnauthorized: false });
						let uploadFileEndpoint 		= this.settings.dataSources["registration-uploads"];
						uploadFileEndpoint 			= uploadFileEndpoint.split(" ").filter(e => e && e)[1];
						let res 					= {};
						logData["sent"]    			= moment().format ( "YYYY-MM-DD HH:mm:ss:SSSS");
						logData["esb-endpoint"]    	= uploadFileEndpoint;
						//handle base url
						if(!uploadFileEndpoint.startsWith("http") && this.settings.dataSources.baseURL){
							uploadFileEndpoint = `${this.settings.dataSources.baseURL}${uploadFileEndpoint}`;
						}
                            
						try {
							let instance = uploadFileEndpoint.startsWith("https") ? axios.create ({ httpsAgent }) : axios.create();
							res = await instance.post(
								`${uploadFileEndpoint}`,
								form_data,
								{ headers: {
									...request_config,
									...form_data.getHeaders()
								}}
							);
						} catch (error) {
							console.error(error.message);
							res = error.response;
						}
						let feedback = res.data;

						//log types
						logData["received"] = moment().format ( "YYYY-MM-DD HH:mm:ss:SSSS");
						let sent            = moment ( logData.sent,"YYYY-MM-DD HH:mm:ss:SSSS"  ),
							received        = moment ( logData.received,"YYYY-MM-DD HH:mm:ss:SSSS" );
						logData.latency     = `${received.diff(sent, "milliseconds")} ms`;
						logData.type 		= feedback ? "info" : "debug";
						logData.clientResponse = feedback;
						ctx.emit("create.log", logData);

						resolve(feedback);
					});

					ctx.params.on ( "error", err => {
						reject({
							message: "File error received",
							success: false,
							filename: path.basename ( filePath ),
							location: `File error received -  ERROR: ${err.message}`
						});
						f.destroy(err);
					});

					f.on( "error", ( err ) => {
						console.error(`File error received -  ERROR: ${err.message}` );
						// Remove the errored file.
						fs.unlinkSync ( filePath );
					});

					ctx.params.pipe ( f );
				});
			}
		}
	},

	methods: {
		async apiSettings () {
			let keys = [
				[this.settings.appName, "config", "config"].join(":")
			];
			let redis_data = await this.RedisGetMany(keys);

			let apiConfig = redis_data.config;
			const response = { dataSources: apiConfig["data-sources"] };

			return response;
		},
		async sendRequest  (method, url, data, custom_headers = {}){

			const qs 				  = require("querystring");
			let response              = {};
			let result                = false;
			let code                  = 408;
    
			// Axios Instance
			let instance = axios.create();
    
			if ( url.startsWith ( "https" ) ){
				const https = require ( "https" );
				let httpsAgent  = new https.Agent({ rejectUnauthorized: false });
				instance = axios.create ({ httpsAgent });
			}
            
			instance.defaults.timeout = 300000;
            
			//add headers if enabled
			let header_config = {
				responseType: "stream"
			};
			if (custom_headers) {
				header_config = {
					headers: custom_headers,
					responseType: "stream"
				};
			}
            
			try {
				switch (method) {
					case "get":
						try {
							response = await instance.get( url, data, header_config );
						} catch (error) {
							response = error.response;
						}
						break;
					case "post":
						try {
							if(custom_headers["content-type"]  === "application/x-www-form-urlencoded"){
								response = await instance.post(url, qs.stringify(data), header_config);
							}else{
								response = await instance.post(url, data, header_config);
								// .then(response => {
								//     //write stream file to server
								//     response.data.pipe(fs.createWriteStream(`./store/receipts/${filename}`));
								//     return response
								// })
							}
                            
						} catch (error) {
							response = error.response;
						}
						break;
					case "patch":
						try {
							if(custom_headers["content-type"]  === "application/x-www-form-urlencoded"){
								response = await instance.post(url, qs.stringify(data), header_config);
							}else{
								response = await instance.post(url, data, header_config);
							}
                            
						} catch (error) {
							response = error.response;
						}
						break;
					default:
						break;
				}
				if(response){
					code = response.status;
					result = response.data;
					if(code === 200){
						return {
							success: true,
							code,
							data: result
						};
					}else{
						return {
							success: false,
							code,
							data: result
						};
					}
				}else{
					return {
						success: false,
						code,
						data: result
					};
				}
			}
			catch (e) {
				return {
					success: false,
					code,
					data: result
				};
			}
            
		}
	},
	created() {},
	async started() {
		//Set API settings from redis
		const { dataSources} = await this.apiSettings();
		this.settings.dataSources		= dataSources;
		console.log(`Receipt settings loaded successfully to cache. API calls:::: ${dataSources.baseURL}`);
	},
	async stopped() {
		this.settings.dataSources		= {};
		console.log("API settings removed successfully from cache:::");
	}
};