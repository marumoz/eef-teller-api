"use strict";

const path 					= require("path");
const fs       				= require ( "fs" );
const env    				= require( path.resolve("./env") );
const moment      			= require ("moment");

const statusMessages 		= env.statusMessages;
const UtilitiesMixin        = require("../mixins/utilities.mixin");
const RedisCacheMixin       = require("../mixins/cache.mixin");
const unProtectedRoutes 	= env.unProtectedRoutes;
const secureRoutesLogs 		= env.secureRoutesLogs;

module.exports = {
	name: "transactions",
	settings: {
		log					: true,
		appName             : "eef-teller-api",
		requestSettings 	: {},
		appMeta 			: {},
		appPermissions 		: {},
		dataSources 		: {},
		services 			: {},
		code 		        : {},
		statusMessages		: statusMessages
	},
	mixins: [ UtilitiesMixin, RedisCacheMixin ],
	dependencies: [],
	actions: {
		appRequest: {
			async handler(ctx) {
				let { payload: reqData } = ctx.params;
				let { data: payload, publicKey } = this.aesDecrypt(reqData);

				let response = await await ctx.call("transactions.mainRequest",{ payload });
				return {
					message: await this.aesEncrypt({ ...response, requestId: payload.requestId }, publicKey)
				};
			}
		},
		mainRequest: {
			async handler(ctx) {
				let { payload } = ctx.params;

				// console.log(">>>>>>>>>>>>>>>>>>>",JSON.stringify({params: ctx.params, payload}, null, 4));

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
					clientIp	: ctx.meta.clientIp,
					userDevice 	: ctx.meta.userDevice
				};

				if(!payload){
					logData.response = feedback;
					logData.type = "error";
					logData.response = "Payload decryption failed";
					ctx.emit("create.log", logData);

					return feedback;
				}

				let isAuthorized = await ctx.call("transactions.verifyTransaction", { payload });
                
				if(!isAuthorized.success){
					logData.response = feedback;
					logData.type = "error";
					logData.response = "Failed user validation session";
					ctx.emit("create.log", logData);
                    
					return feedback;
				}

				try {
					let { transactionType, payload: requestData } = payload;
					let { userDevice, clientIp } = ctx.meta;

					let serviceName = transactionType;
					let serviceData = {
						clientIp,
						deviceType: ctx.meta.userDevice?.deviceType || "Computer",
						deviceInfo: `${userDevice.osName} ${userDevice.deviceType} ${userDevice.brand} ${userDevice.clientType} ${userDevice.clientName}`,
						...isAuthorized.meta,
						...requestData,
						floatAccount: isAuthorized?.floatAccount || ""
					};

					//Run validations
					const schema = this.settings.services[serviceName];

					if(schema){
						const Validator = require("fastest-validator");
						const v      = new Validator();
						let validate = v.validate (serviceData, schema);
						if ( validate !== true ) {
							feedback.status = 402;
							feedback.message = statusMessages[402];
							feedback.error = validate[0].message;
							logData.type = "error";
						}else{
                            
							//get request
							let reqEnpoint = this.settings.requestSettings.endpoints[serviceName];

							let reqResponse = await this.sendRequest(reqEnpoint, serviceData);

							// console.log(JSON.stringify({ reqResponse}, null, 4));

							//Build Reponse
							feedback.status 		= reqResponse.message;
							feedback.success 		= reqResponse.success;
							feedback.message 	    = reqResponse.errorMessage || statusMessages[reqResponse.message];
							feedback.data 			= this.applyPosthooks(reqResponse.data, { ...serviceData, transactionType: serviceName });

							logData.txnType = reqEnpoint?.request?.field100 || transactionType;
							logData["esb-request"] = { 
								...reqResponse,
								message		: statusMessages[reqResponse.message],
								error		: reqResponse.errorMessage,
								esbDuration : reqResponse.requestTime
							};

							//log types
							if(!feedback.success){
								logData.type = "debug";
							}
							if(reqResponse.requestNotRec){
								logData.type = "error";
							}
						}
            
					}else{
						logData.type = "error";
						feedback.status = 98;
						feedback.error = "Schema does not exist";
						feedback.message = this.settings.statusMessages[98];
					}
                    
					//Logs
					logData.clientResponse = {...feedback};
					if(logData["esb-request"] && logData["esb-request"]["request"]){
						logData["esb-request"]["request"]["headers"]["Authorization"] = "Auth token";
					}
					if(secureRoutesLogs.includes(serviceName) && logData.type === "info"){
						logData.clientResponse = `${serviceName} successful`;
						if(feedback.success){
							logData["esb-request"]["data"] = {};
							// logData["requestParams"]["payload"] = {};
							// logData["esb-request"]["request"]["data"] = {};
						}
					}

				} catch (error) {
					console.error(error);
					feedback.status = 500;
					feedback.error = error.message;
					feedback.message = statusMessages[500];

					logData.error = error;
					logData.type = "error";
					logData.clientResponse = {...feedback};
				}
                
				ctx.emit("create.log", logData);
				// send analytics
				if( payload.transactionType !== "customer-audit-trail"){
					ctx.call("logger.sendAnalytics", { payload: logData, transactionType: payload.transactionType, runAnalytics: env["enable-analytics"] });
				}

				// console.log(JSON.stringify({feedback}, null, 4));
				return feedback;
			}
		},
		verifyTransaction: {
			async handler (ctx) {
				let isAuthorized = { success: false };
				let { payload } = ctx.params;

				if(unProtectedRoutes.includes(payload.transactionType)){
					isAuthorized = { success: true, meta: {} };
				}
    
				try {
					if(!unProtectedRoutes.includes(payload.transactionType)){
						isAuthorized = await ctx.call("login.serverVerifySession", { 
							payload: { 
								payloadUser	: payload?.payload?.username,
								username	: ctx.meta.user.username, 
								requestParams: payload?.payload,
								transactionType: payload.transactionType,
								module 		: `transaction-service - ${payload.transactionType}`
							}
						});
					}
				} catch (error) {
					this.logger.info("User Authorization failed", error);
				}
    
				return isAuthorized;
			}
		}
	},
	events: {

	},
	methods: {
		async apiSettings () {
			let keys = [
				[this.settings.appName, "config", "api"].join(":"),
				[this.settings.appName, "config", "services"].join(":"),
				[this.settings.appName, "config", "config"].join(":"),
				[this.settings.appName, "config", "code"].join(":")
			];
			let redis_data    = await this.RedisGetMany(keys);

			let response = {
				requestSettings: {}, 
				appMeta: {}, 
				appPermissions: {}, 
				dataSources: {}, 
				services: {}, 
				code: {}
			};
			if(Object.keys(redis_data.api).length > 0 && Object.keys(redis_data.services).length > 0){
				let apiData = redis_data.api;
				let apiConfig = redis_data.config;
				response = {
					requestSettings 	: apiData["request-settings"],
					appMeta 			: apiConfig["meta-data"],
					appPermissions 		: apiConfig["permissions"],
					dataSources 		: apiConfig["data-sources"],
					services 			: redis_data["services"],
					code 				: redis_data["code"]
				};
			}

			return response;
		},
		runReplacements(template, payload){
    
			try {
				const { flatten, unflatten } = require("flat");
				let replacements 	= [];
				let failed 			= [];
				let params 			= flatten(payload, { safe: true });
    
				let querySettings = JSON.stringify(template);
    
				let paramKeys = Object.keys(params);
				let payloadKeys = Object.keys(payload);
    
                
				let queryValues = Object.values(flatten(template));
                
				for( let entry of queryValues){
					entry = entry.toString();
					if(entry.startsWith("__")){
						let entries = entry.split("__").filter(e => e && e);
                        
						entries.forEach(e => {
							replacements.push(`__${e}`);
						});
					}
                    
				}
    
				//for failed replace with empty values no errors
				for ( let replacement of replacements){
					let placement = replacement.replace(/__/g, "");
    
					if(replacement.includes(";")){
						placement = placement.split(":")[0];
					}
    
					if(![ ...paramKeys, ...payloadKeys ].includes(placement)){
						failed.push(replacement);
						replacements = replacements.filter(item => item !== replacement);
					}
				}
    
				for ( let replacement of replacements){
    
					let regEx = "";
					if(replacement.includes(";")){
						replacement = replacement.split(":")[0];
					}
					let placement = replacement.replace(/__/g, "");
					let value = params[placement] || payload[placement];
					regEx = new RegExp(replacement, "g");

					if(typeof value === "object"){
						value = JSON.stringify(value);
						regEx = new RegExp(`"${replacement}"`, "g");
                        
						querySettings = querySettings.replace(regEx, value);
					}else{
						querySettings = querySettings.replace(regEx, value);
					}
				}
    
				//full replacements - with empty string if validation fails
				for (let failure of failed){
					let regEx = "";
					regEx = new RegExp(failure, "g");
					querySettings = querySettings.replace(regEx, "");
					//querySettings = querySettings.replace(/undefined/g, '')
				}
                
				querySettings = querySettings.replace(/\n/g, "\\n").replace(/\t/g, "");
				querySettings = JSON.parse(querySettings);
                
				let keys = Object.keys(flatten(querySettings));
    
				//create defaults - create?;case?=args
				//handle format values - value;case
				for ( let key of keys){
					let queParams = flatten(querySettings);
					let relValue = queParams[key], value = queParams[key], newValue = "";
					value = value.toString();

					if(value.startsWith("construct") && value.includes(";")){
						let methodName = value.split(";")[1];
						newValue = this[methodName](payload);
					}else if(value.includes("construct") && value.includes(";")){
                        
						let methodName = value.split(";")[1];
						let args  = value.split(":")[0];
    
						if(args.startsWith("%@")){
							args = args.replace("%@", "");
							args = querySettings[args];
						}
    
						newValue = this[methodName](payload, args);
					}else{ /* empty */ }
    
					if(value.startsWith("create") && value.includes(";")){
						let parts = value.split(";")[1];
						let methodName = parts.split("=")[0];
						let args  = parts.split("=")[1];
    
						if(args){
							newValue = this[methodName](args);
						}else{
							newValue = this[methodName]();
						}
    
                        
					}else if(value.includes("create") && value.includes(";")){
                        
						let methodName = value.split(";")[1];
						let args  = value.split(":")[0];
    
						if(args.startsWith("%@")){
							args = args.replace("%@", "");
							args = querySettings[args];
						}
    
						newValue = this[methodName](args);
					}else{ /* empty */ }
    
					if(typeof newValue === "object"){
						querySettings = { ...querySettings, ...newValue};
    
						if(value.startsWith("%@")){
							let methodName = value.split(";")[1];
							querySettings[key] = newValue[methodName];
						}
						let objKeys = Object.keys(newValue);
						for(let key of objKeys){
							newValue = querySettings[key];
						}
                        
                        
					}
					querySettings[key] = newValue || relValue;
    
                    
				}
    
				//handle placeholders - %@placeholder -- if not in requests put blank
				for (let key of keys){
					let value = querySettings[key];
					value = value.toString();
					if(value.startsWith("%@") && keys.includes(value.replace("%@", ""))){
						let placeholder = querySettings[key].replace("%@", "");
						querySettings[key] = querySettings[placeholder];
					}else if(value.startsWith("%@") && !keys.includes(value.replace("%@", ""))){
						querySettings[key] = "";
					}else{ /* empty */ }
				}
    
				let dataKeys = Object.keys(flatten(querySettings));
				let requestString = JSON.stringify(querySettings);
    
				// handle inline %@ & @
				for (let key of dataKeys){
                    
					let value = querySettings[key];
					value = value.toString();
					if(value.includes("@")){
						let parts = value.split(" ");
						for(let itemParts of parts){
							let regEx = "";
							if(itemParts.startsWith("%@")){
								let placeholder = itemParts.replace("%@", "");
        
								regEx = new RegExp(itemParts, "g");
								requestString = requestString.replace(regEx, querySettings[placeholder]);
							}
							if(itemParts.startsWith("@")){
								let placeholder = itemParts.replace("@", "");
								placeholder = placeholder.replace(/,/g, "");
								placeholder = placeholder.split(".")[0];
        
								regEx = new RegExp(itemParts, "g");
								requestString = requestString.replace(regEx, params[placeholder]);
								requestString = requestString.replace(/undefined/g, "");
							}
						}
                        
                        
					}
				}
                
				requestString = requestString.replace(/\n/g, "\\n").replace(/\t/g, "");
				requestString = JSON.parse(requestString);
				querySettings = requestString;
    
				//handle get;metaData - doesn't exist put blank
				for (let key of keys){
					let value = querySettings[key];
					value = value.toString();
					let metaKeys = Object.keys(this.settings.appMeta);
					if(value.startsWith("get;") && metaKeys.includes(value.replace("get;", ""))){
						let placeholder = querySettings[key].replace("get;", "");
						querySettings[key] = this.settings.appMeta[placeholder];
					}else if(value.startsWith("get;") && !metaKeys.includes(value.replace("get;", ""))){
						querySettings[key] = "";
					}else{ /* empty */ }
				}
    
				//handle config;mpesa.clientid - doesn't exist put blank
                
				for (let key of keys){
					let value = querySettings[key];
					value = value.toString();
					let configData = flatten(env);
					let configKeys = Object.keys(configData);
                    
					if(value.startsWith("config;") && configKeys.includes(value.replace("config;", ""))){
						let placeholder = querySettings[key].replace("config;", "");
						querySettings[key] = configData[placeholder];
					}else if(value.startsWith("config;") && !configKeys.includes(value.replace("config;", ""))){
						querySettings[key] = "";
					}else{ /* empty */ }
				}
    
				querySettings = unflatten(querySettings);
    
				return querySettings;
                
			} catch (error) {
				console.error(error);
				return {
					success: false,
					reqError: `Partial replacements falied ${error.message}`
				};
			}
            
		},
		async generateRequest(request, payload){
    
			try {
				let data 			= payload;
				let appPerm 		= this.settings.appPermissions;
				let reqPermissions 	= request.ignorePermissions;
				let url 			= this.settings.dataSources.default;
				//let method 			= this.settings.dataSources.method || 'post'
				let headers 		= this.settings.requestSettings.headers.default;
				let payloadFormat 	= this.settings.appMeta["payload-format"];
    
				//run permissions on data(base64/encryption) - if encryption true run encryption first
                
				if(request["override-payload-format"]){
					payloadFormat = request["override-payload-format"];
				} 

				//Payload format
				if(payloadFormat !== "JSON"){
					data = this[payloadFormat](data);
				}

				if(appPerm.encrypt && !reqPermissions){
					data = this.aesEncrypt(JSON.stringify(data));
				}

				if(appPerm.base64 && !reqPermissions){
					data = this.base64(data);
				}
    
				//handle overrides - on permissions - if request says false ignore all perm
				if(request["override-source"]){
					url = this.settings.dataSources[request["override-source"]];
				} 
				if(request["override-headers"]){
					headers = this.settings.requestSettings.headers[request["override-headers"]];
				} 
                
				//Split URL and Method
				let urlMethod = url.split(" ").filter(item => item && item);
                
				url = urlMethod[1];
				//handle base url
				if(!url.startsWith("http") && this.settings.dataSources.baseURL){
					url = `${this.settings.dataSources.baseURL}${url}`;
				}
				let method = urlMethod[0].toLowerCase();
                
				//run - replacments for path-params
				//add replacement function for query params - try %@placeholder - path-params <url/>:<port/>/<param/><param/>
				// if(url.includes('%@') && request['path-params']){
				// 	let pathKeys = Object.keys(request['path-params'])
				// 	for(let key of pathKeys){
				// 		let value = request['path-params'][key]
				// 		let regEx = new RegExp(`%@${key}`, 'g')
				// 		url = url.replace(regEx, value)
				// 	}
				// }
				if(url.includes("%@") && request["path-params"]){
					let pathRep = url.split("%@").filter(e => e && e);
					pathRep.shift(); //remove first element for ip && port
					for( let rep of pathRep ){
						rep = rep.split("&")[0];
						if(Object.keys(request["path-params"]).includes(rep)){
							let value = request["path-params"][rep];
							let regEx = new RegExp(`%@${rep}`, "g");
							url = url.replace(regEx, value);
						}
					}
				}
    
				//Found the use case on both Swivel & IB
				//separate generate request - applyHeaders()
				//applyheaders(headers, data)
				//run token fetch for Auth header
				//returns headers
				headers = await this.applyHeaders(headers, payload);

				//create form data for formData request
				if(headers["content-type"] === "multipart/form-data"){
					let FormData = require("form-data");
					let form_data = new FormData();

					if(payload.attachments && payload.attachments.length > 0){
						for (let i = 0; i < payload.attachments.length; i++) {
							form_data.append("file", fs.createReadStream(payload.attachments[i].path));
						}
					}
					delete data.attachments;
					form_data.append("message", JSON.stringify(data));
                    
					headers = { ...headers, ...form_data.getHeaders() };
					data = form_data;
				}
    
				return {
					success: true,
					method,
					url,
					data,
					headers
				};
			} catch (error) {
				console.error(error);
				return {
					success: false,
					reqError: `Generate request falied ${error.message}`
				};
			}
            
		},
		async applyHeaders(headers, payload){
			try {
                
				//Auth header to always fetch token and add to headers - JWT template - can have option to run query fetch token
				//JWT template - specify url, headers, body, success field - will proceed even when fetch token fails - adds failed res data as token - run replacements on data with payload data - include option to run query 'fetch-token' with payload data,
				//fetch url, method, headers - authorization header(jwtToken - template) - fetch token before proceeding
				let authHeader = headers["Authorization"];
				let setHeaders = { ...headers };
    
				if(authHeader && authHeader === "fetch"){
					let authRequest = this.settings.requestSettings.endpoints.jwtToken;
					let authData = authRequest.data;
					let authUrl = this.settings.dataSources.jwtToken;
					let autHHeaders = authRequest.headers;
					let tokenField = authRequest.response.token.field;
					let token = "";

					//Split URL get Method
					let urlMethod = authUrl.split(" ").filter(item => item && item);
                
					authUrl = urlMethod[1];
					//handle base url
					if(!authUrl.startsWith("http") && this.settings.dataSources.baseURL){
						authUrl = `${this.settings.dataSources.baseURL}${authUrl}`;
					}
					let method = urlMethod[0].toLowerCase();
    
					authData = this.runReplacements(authData, payload);
    
					let response = await this.httpFetch(
						method,
						authUrl,
						authData,
						autHHeaders
					);

					//console.log('AUTH JWT',{ authUrl, authData, JWTData: response.data})
    
					if(response.success && tokenField === "responseData"){
						token = response.data;
					}else if(response.success && tokenField){
						token = response.data[tokenField];
					}else{
						token = response.data;
					}
    
					setHeaders["Authorization"] = `Bearer ${token}`;
    
				}
				// else if(authHeader && authHeader === 'query'){
				// 	let authRequest = this.settings.requestSettings.endpoints.jwtToken
				// 	let authData = authRequest.data
				// 	authData = this.runReplacements(authData, payload)
    
				// 	let dbResults = await this.db.query('fetch-token', authData)
				// 	let token = ''
				// 	if(dbResults.success){
				// 		token = dbResults.data['Session_ID']
				// 	}
    
				// 	setHeaders['Authorization'] = `Bearer ${token}`
				// }
    
				return setHeaders;
			} catch (error) {
				console.error(error);
				return {
					success: false,
					reqError: `Apply headers falied ${error.message}`
				};
			}
		},
		applyPrehooks(request, params){
			try {
				//attachments
				if(params.attachments){
					request.attachments = params.attachments;
				}
				//capital services
				if(request.field3 === "450000"){
					request.field127 = params.presentmentData;
				}
				//USOA
				if(request.field100 === "USOA"){
					request.field127 = params.lookupDetails;
				}
				//console.log ( JSON.stringify ( request, null, 4 ) )

				return request;
			} catch (error) {
				console.error(error);
				return {
					success: false,
					reqError: `Apply Prehooks falied ${error.message}`
				};
			}
		},
		async sendRequest(request, params){
			//return httpFetch data & reqData
			try {
				let requestData = { ...request.request };
				let appTemplate = this.settings.requestSettings.template;
				let pathParams = request["path-params"];
				let sendReqData = { ...request };
				//Add template
				if(!request["remove-template"]){
					requestData = { ...appTemplate, ...request.request };
				}
				//Include all payload fields
				if(request["include-all-fields"]){
					requestData = { ...requestData, ...params };
				}
    
				//run full replacements and request
				requestData = this.runReplacements(requestData, params);
    
				//apply prehooks
				requestData = this.applyPrehooks(requestData, { ...params, ...requestData});

    
				//if request contains path-params run replacements on path-params
				if(pathParams){
					pathParams = this.runReplacements(pathParams, params);
					sendReqData["path-params"] = pathParams;
				}
    
				let sendRequest = await this.generateRequest(sendReqData, requestData);

				let requestTime = {
					sent: moment().format ( "YYYY-MM-DD HH:mm:ss:SSSS")
				};
    
				let response = await this.httpFetch(
					sendRequest.method,
					sendRequest.url,
					sendRequest.data,
					sendRequest.headers
				);

				requestTime["received"] = moment().format ( "YYYY-MM-DD HH:mm:ss:SSSS");
				let sent            = moment ( requestTime.sent,"YYYY-MM-DD HH:mm:ss:SSSS"  ),
					received        = moment ( requestTime.received,"YYYY-MM-DD HH:mm:ss:SSSS" );
				requestTime.latency     = `${received.diff(sent, "milliseconds")} ms`;
    
				if(response.success){
					response = await this.parseResponse(request, response);
				}else{
					response = {
						success: false,
						data: response.data,
						message: 99,
						errorMessage: "request was unsuccessful",
						requestNotRec: true
					};
				}
    
				//return request data for logging & reference data
				response.request = sendRequest;
				response.requestTime = requestTime;
    
				return response;
    
			} catch (error) {
				console.error(error);
				return {
					success: false,
					reqError: `Send Request failed ${error.message}`
				};
			}
		},
		async parseResponse(request, response){
			let dot = require("dot-object");
			try {
				let data 			= response.data;
				let appPerm 		= this.settings.appPermissions;
				let reqPermissions 	= request.ignorePermissions;
				let success 		= false;
				let payloadFormat 	= this.settings.appMeta["payload-format"];
    
				//decode
				//check app permissions decodes - req over-rides
				if(appPerm.encrypt && !reqPermissions){
					data = this.aesDecrypt(data);
				}
				if(appPerm.base64 && !reqPermissions){
					data = this.base64Decode(data);
				}

				if(request["override-payload-format"]){
					payloadFormat = request["override-payload-format"];
				} 

				//Payload format
				if(payloadFormat === "XML"){
					data = await this.xml2Json(data);
				}
    
				//after decoding run fromJSON
				data = this.fromJSON(data);

				//Get response codes/fields
				let responseCfg = request["response"];
				let fieldToCheck = responseCfg.status.field;
				let matchingValues = responseCfg.status.matches;
				let message = responseCfg.status.statusMessage || 0;
				let errMessage = responseCfg.status.error.message;
				let errorMessage = "";
    
				//check on codes
				//check for all success codes/fields
				//check if code/data field
				//check if code 200 !200 - always pass success if request failed
				//response field to include | to check different field same response match - status|Status|STATUS - PG
				if(fieldToCheck === "code" && matchingValues.includes("!200")){
					success = true;
				}else if(fieldToCheck === "code"){
					success = matchingValues.includes(response.code.toString());
				}else if(fieldToCheck.includes("|")){
					let fields = fieldToCheck.split("|");
					for (let field of fields){
						if(matchingValues.includes(data[field])){
							success = true;
							break;
						}
					}
				}else{
					//use dot-object to obtain nested response fields
					success = matchingValues.includes(dot.pick(fieldToCheck, data));
				}
                
				//check error data/field
				if(!success && errMessage === "responseData"){
					errorMessage = data;
				}else if(!success){
					//use dot-object to obtain nested response fields
					errorMessage = dot.pick(errMessage, data);
				}
                
				//add formatter - return json
				if(success && responseCfg["adapter"]){
					const methodName = responseCfg["adapter"];
					const codeString = this.settings.code[methodName];

					const fn = new Function("return " + codeString)();
					data = fn(data);
				}
    
				data = this.applyPosthooks(data);
    
				if(!success){
					message = responseCfg.status.error.statusMessage || 99;
				}
    
				return {
					success,
					data,
					//eSBData: response.data,
					message,
					errorMessage
				};
    
			} catch (error) {
				console.error(error);
				return {
					success: false,
					message: 99,
					data: response.data,
					errorMessage: "request unsuccessful",
					reqError: `Parse Response falied ${error.message}`
				};
			}
		},
		applyPosthooks(data, reqData){
			//let postData = { ...data }
			try {
    
				//add posthooks - data - add, change - if dont require formatter
				if(reqData && reqData.transactionType && data && data["field39"]){
					switch (reqData.transactionType) {
						case "account-lookup-validation":
						case "internal-account-lookup":
						case "core-account-lookup":
						case "wallet-account-lookup":
						case "account-lookup":{
							//Clean Response
							let appResponse = {
								"transSuccess": data.field39,
								transDescription: data.field48,
								idNumber: data.field127 ? data.field127["ID_Number"] : "",
								address: data.field127 ? data.field127["Physical_Address"] : "",
								email: data.field127 ? data.field127["Email"] : "",
								bussinessNumber: data.field127 ? data.field127["Business_Number"] : "",
								postalAddress: data.field127 ? data.field127["Postal_Address"] : "",
								kraPIN: data.field127 ? data.field127["KRA_Pin"] : "",
								accountNumber: data.field102,	
								accountName: data.field127 ? data.field127["Customer_Name"] : "",		
								branch: data.field127 ? data.field127["Branch_Code"] : "",
								branchName: data.field127 ? data.field127["Branch_Name"] : "",
								phoneNumber: data.field127 ? data.field127["Mobile_No"] : "",		
								customerNumber: data.field127 ? data.field127["Customer_No"] : "",	
								lookupDetails: data.field127 || {},
							};
                            
							data = appResponse;
						}break;
                    
						default:{
							//Clean Response
							let fieldKeys = Object.keys(data);
							let appResponse = {
								"transSuccess": data.field39,
								"transDescription": data.field48,
								"transactionCode": data.field37,
								"transactionType": data.field100,
								"presentmentAmt": data.field4,
								"presentmentRef": data.field69,
								"presentmentAccName": data.field125,
								"accountBalance": data.field54,
								"c2cRef": data.field80,
								"details": data.field127
							};
                            
							for ( let key of fieldKeys){
								if(!key.startsWith("field")){
									appResponse[key] = data[key];
								}
							}
							data = appResponse;
						}break;
					}
				}
    
				return data;
    
			} catch (error) {
				console.error(error);
				return {
					success: false,
					reqError: `Apply post hooks falied ${error.message}`
				};
			}
		}
	},
	created() {},
	async started() {
		//Set API settings from redis
		const { requestSettings, appMeta, appPermissions, dataSources, services, code } = await this.apiSettings();
		this.settings.requestSettings	= requestSettings;
		this.settings.appMeta 			= appMeta;
		this.settings.appPermissions 	= appPermissions;
		this.settings.dataSources		= dataSources;
		this.settings.services			= services;
		this.settings.code			    = code;
		console.log(`API settings loaded successfully to cache. API calls:::: ${dataSources.baseURL}`);
	},
	async stopped() {
		this.settings.requestSettings	= {};
		this.settings.appMeta 			= {};
		this.settings.appPermissions 	= {};
		this.settings.dataSources		= {};
		this.settings.services			= {};
		this.settings.code			    = {};
		console.log("API settings removed successfully from cache:::");
	}
};
