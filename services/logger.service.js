"use strict";

const moment = require("moment");
const winston = require("winston");
const path 	 = require("path");
const env    = require( path.resolve("./env") );

const UtilitiesMixin    = require("../mixins/utilities.mixin");
require("winston-daily-rotate-file");

module.exports = {
	name        : "logger",

	mixins: [ UtilitiesMixin ],

	actions     : {
		customerAuditTrail: {
			params: {
				payload 	: "string"
			},

			async handler (ctx){

				let { userDevice } = ctx.meta;
				let { payload } = ctx.params;
				let decrypted = this.aesDecrypt(payload);

				let moduleIds = {
					"transaction charges"			: "3001",
					"stage transaction"				: "3002",
					"submit transaction"			: "3003",
					"login"							: "3004",
					"otp"							: "3005",
					"password reset"				: "3006",
					"registration"					: "3007",
					"acccount linking"				: "3008",
					"bulk upload"					: "3009",
					"password change"				: "3010",
					"calculator"					: "3011",
					"change account limits"			: "3012",
					"account mandates authorization": "3013",
					"account beneficiaries"			: "3014",
					"account mandatees"				: "3015",
					"customer reports"				: "3016",
					"view page"						: "3017",
					"canceled transaction"			: "3018",
					"print receipt"					: "3019",
					"account activation"			: "3020"
				};
                
				let moduleId = moduleIds[decrypted.module.toLowerCase()] || "3333";

				let params = {
					"transactionType": "customer-audit-trail",
					payload: {
						username 		: decrypted.username,
						moduleName 		: decrypted.module,
						moduleId    	,
						activePage 		: decrypted.page,
						customerAccount	: decrypted.account,
						activity		: decrypted.activity, 
						agentName	    : decrypted?.agentName || "",
						agentCode	    : decrypted?.agentCode || "",
						outletCode	    : decrypted?.outletCode || "",
						operatorCode    : decrypted?.operatorCode || "",
						ip				: ctx.meta.clientIp,
						device			: `${userDevice.osName} ${userDevice.deviceType} ${userDevice.brand} ${userDevice.clientType} ${userDevice.clientName}`
					}
				};

				ctx.call("transactions.request", { payload: this.aesEncrypt(params) });
				ctx.call("analytics.usage", { payload: params.payload, runAnalytics: env["enable-analytics"] });

				return {
					message: this.aesEncrypt({ success: true })
				};
			}
		},
		sendAnalytics: {
			async handler (ctx){
				return;     
			}
		}
	},
	events      : {
		"create.log"(payload){
			//log...
			payload.timestamp = moment().format();
			let filenameExt = `${payload.service}-${payload.type}`;
			let pathLog = env["LOGS_PATH"];
			if(!pathLog.endsWith("/")){
				pathLog = `${pathLog}/`;
			}

			const transport = new (winston.transports.DailyRotateFile)({
				filename: filenameExt,
				datePattern: "YYYY-MM-DD",
				extension: ".log",
				zippedArchive: false,
				maxSize: "5m",
				dirname: `${pathLog}${moment().format("YYYY-MM-DD")}`,
				maxFiles: env["MAX_LOG_DAYS"]
			});
             
			const logger = winston.createLogger({
				transports: [
					transport
				]
			});
             
			logger.info(payload);

		}
	},
	methods     : {},
	created		 () {},
	async started() {},
	async stopped() {}
};