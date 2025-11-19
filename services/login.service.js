"use strict";

const CryptoJS          = require("crypto-js");
const env               = require("../env.json");
const UtilitiesMixin    = require("../mixins/utilities.mixin");
const SessionMixin      = require("../mixins/session.mixin");

const encryptionKeys    = env.encryption;
const passwordUuid    	= encryptionKeys.passwordUuid;

module.exports = {
	name: "login",

	mixins: [ UtilitiesMixin, SessionMixin ],

	settings: {
		appName: "eef-teller-api"
	},

	actions: {
		login: {
			params: {
				username: "string",
				password: "string"
			},
			async handler (ctx) {
				let logData = {
					type: "info",
					action: "login",
					service : ctx.service.fullName,
					user: ctx.params.username,
					response: {},
					userDevice: ctx.meta.userDevice
				};

				let { username, password } = ctx.params;
				const { clientIp } = ctx.meta;

				let response = {
					success     :false,
					message     :"Wrong username or password provided"
				};

				const hashedPass = this.encryptNewPassword(password, username);

				if(hashedPass){
					let payload = {
						"transactionType": "login", 
						"payload": {
							username     ,
							"password"   : hashedPass,
							"ipAddress"  : ctx.meta.clientIp
						}
					};

					let res = await ctx.call("transactions.mainRequest", { payload });

					if(res.success) {
						const jwtToken = this.signToken({ username });

						//set session data to redis
						this.setloginSession({
							appName: this.settings.appName, 
							username: username, 
							userData: res.data,
							floatAccount: res.data.accountInfo.floatAccount,
							token: jwtToken, 
							ipAddress: clientIp 
						});
                        
						const resData = { ...res.data, sessionId: "session-id", token: jwtToken };
						resData.accountInfo.floatAccount = this.obscureAccountNumber(resData.accountInfo.floatAccount);
						response = {
							success     : true,
							data        : resData,
							message     : "Login successful"
						};

					}else{
						logData.type = "debug";
						response = {
							success     : false,
							data        : res.data,
							message     : res.message
						};
						logData.response = response;
					}
				}else{
					logData.response = response;
					logData.type = "error";
					logData.reason = "password encryption failed";
				}

				ctx.emit("create.log", logData);

				return response;
			}
		},
		verifyOtp: {
			async handler (ctx) {
				let { payload: reqData } = ctx.params;
				let { data: payload, publicKey } = this.aesDecrypt(reqData);

				let logData = {
					type: "info",
					action: "verify-otp",
					service : ctx.service.fullName,
					user: payload.username,
					response: {},
					userDevice: ctx.meta.userDevice
				};

				let { username, otp, requestId, verificationType } = payload;

				let response = {
					success     :false,
					message     :"Request failed"
				};

				let hashedPass = this.encryptNewPassword(otp, username);

				if(hashedPass){
					let params = {
						"transactionType": verificationType === "TOTP" ? "verify-totp" : "verify-otp", 
						"payload": {
							username,
							direction: verificationType,
							token: hashedPass,
							ipAddress: ctx.meta.clientIp
						}
					};
					let res = await ctx.call("transactions.mainRequest", { payload: params });

					if(res.success) {
						response = {
							success     : true,
							data        : res.data,
							message     : "Verification successful",
							requestId
						};
					}else{
						logData.type = "debug";
						response = {
							success     : false,
							data        : res.data,
							message     : res.message
						};
					}
				}else{
					logData.type = "error";
					logData.reason = "otp encryption failed";
				}

				logData.response = response;
				ctx.emit("create.log", logData);

				return {
					message: await this.aesEncrypt(response, publicKey)
				};
			}
		},
		changePassword: {
			async handler (ctx) {
				let { payload: reqData } = ctx.params;
				let { data: payload, publicKey } = this.aesDecrypt(reqData);

				let logData = {
					type: "info",
					action: "change-password",
					service : ctx.service.fullName,
					user: payload.username,
					response: {},
					userDevice: ctx.meta.userDevice
				};

				let { username, currentPassword, confirmPassword, requestId, meta } = payload;

				let response = {
					success     :false,
					message     :"Request failed"
				};

				let hashedCurrPass = this.encryptNewPassword(currentPassword, username);
				let hashedNewPass = this.encryptNewPassword(confirmPassword, username);

				if(hashedCurrPass && hashedNewPass){
					let params = {
						"transactionType": "change-password", 
						"payload": {
							username     ,
							"currentPassword"   : hashedCurrPass,
							"newPassword"       : hashedNewPass
						},
						meta
					};

					let res = await ctx.call("transactions.mainRequest", { payload: params });

					if(res.success) {
						response = {
							success     : true,
							data        : res.data,
							message     : "Verification successful",
							requestId
						};
					}else{
						logData.type = "debug";
						response = {
							success     : false,
							data        : res.data,
							message     : res.message
						};
					}
				}else{
					logData.type = "error";
					logData.reason = "Password encryption failed";
				}

				logData.response = response;
				ctx.emit("create.log", logData);

				return {
					message: await this.aesEncrypt(response, publicKey)
				};
			}
		},
		sendOtp:  {
			async handler (ctx) {
				let { payload: reqData } = ctx.params;
				let { data: payload, publicKey } = this.aesDecrypt(reqData);

				let logData = {
					type: "info",
					action: "send-otp",
					service : ctx.service.fullName,
					user: payload.username,
					response: {},
					userDevice: ctx.meta.userDevice
				};

				let { username, phoneNumber, agentName, email, direction } = payload;

				let response = {
					success     :false,
					message     :"Request failed"
				};

				let params = {
					"transactionType": "send-otp", 
					"payload": {
						username,
						phoneNumber,
						agentName,
						direction,
						email
					}
				};

				let res = await ctx.call("transactions.mainRequest", { payload: params });

				if(res.success) {
					response = {
						success     : true,
						message     : res.message
					};
				}else{
					logData.type = "debug";
					response = {
						success     : false,
						message     : res.message
					};
				}

				logData.response = response;
				ctx.emit("create.log", logData);
                
				return {
					message: await this.aesEncrypt(response, publicKey)
				};
			}
		},
		verifySession: {
			async handler (ctx) {
				let { payload: reqData } = ctx.params;
				let { data: payload, publicKey } = this.aesDecrypt(reqData);

				let logData = {
					type: "info",
					action: "verify-session",
					service : ctx.service.fullName,
					user: payload.username,
					module: payload.module,
					response: {},
					userDevice: ctx.meta.userDevice
				};

				let { username, signout } = payload;

				let response = {
					success: false,
					message: "session authentication failed"
				};

				if(signout){
					await this.RedisDelete([ this.settings.appName, "appclients", username ].join(":"));
					return {
						message: await this.aesEncrypt(response, publicKey)
					};
				}else{
					const isAuthenticated = await this.tokenAuthentication({ 
						appName: this.settings.appName, 
						username, 
						ipAddress: ctx.meta.clientIp, 
						userToken: ctx.meta.token, 
						userTokenId: ctx.meta.user.username
					});

					if(isAuthenticated.success){
						response = {
							success: true,
							message: `session authentication successful. User: ${username}`
						};
					}else{
						logData.type = "debug";
						ctx.emit("create.log", logData);

						await this.RedisDelete([ this.settings.appName, "appclients", username ].join(":"));
					}

					return {
						message: await this.aesEncrypt(response, publicKey)
					};
				}

				
			}
		},
		serverVerifySession: {
			async handler (ctx) {
				let { payload } = ctx.params;

				let logData = {
					type: "info",
					action: "verify-session",
					service : ctx.service.fullName,
					user: payload.username,
					module: payload.module,
					transactionType: "",
					response: {},
					requestParams: {},
					userDevice: ctx.meta.userDevice
				};

				let { username, payloadUser, requestParams, transactionType } = payload;

				let response = {
					success     :false,
					message     :"session authentication failed"
				};

				const isAuthenticated = await this.tokenAuthentication({ 
					appName: this.settings.appName, 
					username: payloadUser, 
					ipAddress: ctx.meta.clientIp, 
					userToken: ctx.meta.token, 
					userTokenId: username
				});

				if(isAuthenticated.success){
					const meta = {
						username,
						agentName: isAuthenticated.userData.accountDetails.personalInfo.agentName,
						phoneNumber: isAuthenticated.userData.accountDetails.personalInfo.phoneNumber,
						agentCode: isAuthenticated.userData.accountDetails.agentInfo.agentNumber,
						agentNumber: isAuthenticated.userData.accountDetails.agentInfo.agentNumber,
						outletCode: isAuthenticated.userData.accountDetails.agentInfo.outletCode,
						operatorCode: isAuthenticated.userData.accountDetails.agentInfo.operatorCode,
						businessName: isAuthenticated.userData.accountDetails.agentInfo.businessName,
						branchName: isAuthenticated.userData.accountDetails.agentInfo.branchName,
						outletName: isAuthenticated.userData.accountDetails.agentInfo.branchName,
						operatorCity: isAuthenticated.userData.accountDetails.agentInfo.operatorCity,
						operatorRegion: isAuthenticated.userData.accountDetails.agentInfo.operatorRegion,
						MGAgentID: isAuthenticated.userData.accountDetails.mgInfo.MGAgentID,
						POSNumber: isAuthenticated.userData.accountDetails.mgInfo.POSNumber,
						POSPassword: isAuthenticated.userData.accountDetails.mgInfo.POSPassword
					};
					response = {
						success: true,
						message: "success",
						floatAccount: isAuthenticated.userData.floatAccount.toString(),
						meta
					};
				}else{
					logData.type = "debug";
					logData.response = response;
					logData.transactionType = transactionType;
					logData.requestParams = requestParams;
					ctx.emit("create.log", logData);

					this.RedisDelete([ this.settings.appName, "appclients", username ].join(":"));
				}

				return response;
			}
		}
	},

	methods: {
		encryptNewPassword(userPass, username){
			try {
				let hashedPin = CryptoJS.HmacSHA256(Buffer.from(userPass + username).toString("base64"), passwordUuid ).toString(CryptoJS.enc.Hex);

				return hashedPin;
			} catch (error) {
				console.error(error);
				return false;
			}
		},
		obscureAccountNumber (accountNumber){
		// Replace the first 3 and the last 3 characters with 'X'
			let unmaskedStart = accountNumber.slice(0, 3);
			let unmaskedEnd = accountNumber.slice(0, -3);
			return unmaskedStart + accountNumber.slice(3, unmaskedEnd.length).replace(/./g, "X") + accountNumber.slice(unmaskedEnd.length, accountNumber.length);
		}
	}
};