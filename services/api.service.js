"use strict";

const ApiGateway = require("moleculer-web");
const helmet = require("helmet");
const DeviceDetector = require("node-device-detector");
const detector = new DeviceDetector();
const env = require("../env.json");

/**
 * @typedef {import('moleculer').ServiceSchema} ServiceSchema Moleculer's Service Schema
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 * @typedef {import('http').IncomingMessage} IncomingRequest Incoming HTTP Request
 * @typedef {import('http').ServerResponse} ServerResponse HTTP Server Response
 * @typedef {import('moleculer-web').ApiSettingsSchema} ApiSettingsSchema API Setting Schema
 */

module.exports = {
	name: "api",
	mixins: [ApiGateway],
	settings: {
		port: env.PORT || 4000,
		use: [
			helmet({
				contentSecurityPolicy	: { 
					directives	: {
						defaultSrc		: ["'self'"],
						frameAncestors	: ["'none'"]
					}
				},
				hsts					: {
					maxAge: 86400
				}
			})
		],
		httpServerTimeout: 160000,
		cors: {
			origin: "*",
			methods: ["GET", "POST"],
			credentials: true,
			maxAge: null
		},
		rateLimit: {
			window: 60 * 1000,
			limit: 10000,
			headers: true,
			key: (req) => {
				return req.headers["x-forwarded-for"] ||
                    req.connection.remoteAddress ||
                    req.socket.remoteAddress ||
                    req.connection.socket.remoteAddress;
			}
		},

		routes: [
			{
				path: "/eef-teller-api/main",
				whitelist: [
					"transactions.appRequest",
					"login.*",
					"receipt.*",
					"logger.customerAuditTrail"
				],
				use: [],
				cors			: { 
					origin: "*",
					methods: ["POST"]
				},				
				mergeParams: true,
				authentication: true,
				authorization: true,
				autoAliases: false,
				aliases: {
					"POST transactions": "transactions.appRequest",
					"POST session-auth": "login.verifySession",
					"POST print-receipt": "receipt.printReceipt",
					"POST validate-otp": "login.verifyOtp",
					"POST first-login": "login.changePassword",
					"POST generate-otp": "login.sendOtp",
					"POST audit-trail": "logger.customerAuditTrail",
					"POST upload-docs": {
						type		: "multipart",
						busboyConfig: {
							limits  : {
								files    : 5,
								fileSize : 10 * 1024 * 1024
							},
							onPartsLimt() {
								this.logger.info("Busboy parts limit!");
							},
							onFilesLimit() {
								this.logger.info("Busboy file limit!");
							},
							onFieldsLimit() {
								this.logger.info("Busboy fields limit!");
							}
						},
						action      : "receipt.mgReverseUploads"
					},
					"POST withdarawal-upload-docs": {
						type		: "multipart",
						busboyConfig: {
							limits  : {
								files    : 1,
								fileSize : 10 * 1024 * 1024
							},
							onPartsLimt() {
								this.logger.info("Busboy parts limit!");
							},
							onFilesLimit() {
								this.logger.info("Busboy file limit!");
							},
							onFieldsLimit() {
								this.logger.info("Busboy fields limit!");
							}
						},
						action      : "receipt.altWithdrawalUploads"
					},
					"POST registration-upload-docs": {
						type		: "multipart",
						busboyConfig: {
							limits  : {
								files    : 3,
								fileSize : 10 * 1024 * 1024
							},
							onPartsLimt() {
								this.logger.info("Busboy parts limit!");
							},
							onFilesLimit() {
								this.logger.info("Busboy file limit!");
							},
							onFieldsLimit() {
								this.logger.info("Busboy fields limit!");
							}
						},
						action      : "receipt.registrationUploads"
					}
				},
				callingOptions: {},
				bodyParsers: {
					json: {
						strict: false,
						limit: "1MB"
					}
				},
				onError(req, res, err) {
					res.setHeader("Content-Type", "text/plain");
					res.writeHead(err.code || 500);
					res.end("Route error: " + err.message);
				},
				mappingPolicy: "restrict",
				logging: true
			},
			{
				path             : "/eef-teller-api/auth",
				whitelist        : [ 
					"auth.authToken",
					"auth.getPublicKey",
					"logger.customerAuditTrail"
				],
				cors			: { 
					origin: "*",
					methods: ["POST"]
				},	
				use              : [],
				mergeParams      : true,
				authentication	 : false,
				authorization    : false,
				autoAliases      : false,
				bodyParsers      : {
					json            : {
						strict         : false,
						limit          : "1MB"
					}
				},
				mappingPolicy    : "restrict",
				aliases          : {
					"POST login": "auth.authToken",
					"POST fetch-public-key": "auth.getPublicKey",
					"POST audit-trail": "logger.customerAuditTrail"
				},
				logging: false,
				onBeforeCall(ctx, route, req) {
					console.log(`Authentication for: ${route.path}`);
					let clientIp = req.headers["x-forwarded-for"] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
					ctx.meta.clientIp = clientIp;

					let userDevice = detector.detect(req.headers["user-agent"]);
					let { os: { name: osName }, 
						client: { name: clientName, type: clientType}, 
						device: { type: deviceType, brand }} = userDevice;
					ctx.meta.userDevice =  { osName, clientName, clientType, deviceType, brand, clientIp };
				}
			}
		],
		log4XXResponses: false,
		logRequestParams: null,
		logResponseData: null,
        
		// Global error handler
		onError(req, res, err) {
			res.setHeader("Content-Type", "text/plain");
			res.writeHead(err.code || 500);
			res.end("Global error: " + err.message);
		}
	},

	methods: {
		async authenticate(ctx, route, req) {
			let clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
			ctx.meta.clientIp = clientIp;
			ctx.meta.userDevice = {};

			if(req.headers["user-agent"]){
				let userDevice = detector.detect(req.headers["user-agent"]);
				let { os: { name: osName }, 
					client: { name: clientName, type: clientType}, 
					device: { type: deviceType, brand }} = userDevice;
				ctx.meta.userDevice = { userAgent: req.headers["user-agent"], osName, clientName, clientType, deviceType, brand, clientIp };
			}
			const auth = req.headers [ "authorization" ];
			let token;
			if ( auth && auth.startsWith ( "Bearer " ) ) {
				token = auth.slice ( 7 );
            
				//Verify Token
				if ( token ){
					ctx.meta.token = token;
            
					let verified = await ctx.call("auth.verify", { token } );
            
					if ( verified ) {
						const user = verified.data;
            
						if ( user ) { 
							ctx.meta.user = user;
							return user;
						}else {
							this.logger.info( "User authenticated via JWT. Failed", { token } );
							throw new ApiGateway.Errors.UnAuthorizedError ( ApiGateway.Errors.ERR_INVALID_TOKEN );
						}
					}else {
						this.logger.info( "User authenticated via JWT. Failed", { token } );
						throw new ApiGateway.Errors.UnAuthorizedError ( ApiGateway.Errors.ERR_INVALID_TOKEN );
					}
				}else{
					throw new ApiGateway.Errors.UnAuthorizedError ( ApiGateway.Errors.ERR_NO_TOKEN );
				}
			}else{
				throw new ApiGateway.Errors.UnAuthorizedError ( ApiGateway.Errors.ERR_NO_TOKEN );
			}
		},

		async authorize(ctx) {
			// Get the authenticated user.
			const user = ctx.meta.user;

			if (!user) {
				throw new ApiGateway.Errors.UnAuthorizedError("NO_RIGHTS");
			}
		}

	}
};
