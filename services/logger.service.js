"use strict";

const moment = require("moment");
const winston = require("winston");
const path 	 = require("path");
const env    = require( path.resolve("./env") );

const UtilitiesMixin    = require("../mixins/utilities.mixin");
const SessionMixin      = require("../mixins/session.mixin");
require("winston-daily-rotate-file");

module.exports = {
	name        : "logger",

	mixins: [ UtilitiesMixin, SessionMixin ],

	settings: {
		appName: "eef-teller-api"
	},

	actions     : {
		customerAuditTrail: {
			async handler (ctx){
				const { userDevice, clientIp } = ctx.meta;
				const { payload: reqData } = ctx.params;
				const { data: decrypted, publicKey } = this.aesDecrypt(reqData);

				const moduleIds = {
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
                
				const moduleId = moduleIds[decrypted.module.toLowerCase()] || "3333";
				const isAuthenticated = await this.fetchCacheSession({ 
					appName: this.settings.appName, 
					username: decrypted.username
				});
				let floatAccount, agentName, phoneNumber, agentNumber, outletCode, operatorCode, businessName, branchName, outletName, operatorCity, operatorRegion;
				if(isAuthenticated.success){
					const { accountDetails } = isAuthenticated.userData;
					floatAccount = isAuthenticated.userData.floatAccount.toString();
					agentName = accountDetails.personalInfo.agentName;
					phoneNumber = accountDetails.personalInfo.phoneNumber;
					agentNumber = accountDetails.agentInfo.agentNumber;
					outletCode = accountDetails.agentInfo.outletCode;
					operatorCode = accountDetails.agentInfo.operatorCode;
					businessName = accountDetails.agentInfo.businessName;
					branchName = accountDetails.agentInfo.branchName;
					outletName = accountDetails.agentInfo.branchName;
					operatorCity = accountDetails.agentInfo.operatorCity;
					operatorRegion = accountDetails.agentInfo.operatorRegion;
				}

				const params = {
					"transactionType": "customer-audit-trail",
					payload: {
						username: decrypted.username,
						moduleName: decrypted.module,
						moduleId,
						activePage: decrypted.page,
						customerAccount: decrypted.account,
						activity: decrypted.activity, 
						agentName: agentName || "",
						phoneNumber: phoneNumber || "",
						floatAccount: floatAccount || "",
						agentCode: agentNumber || "",
						outletCode: outletCode || "",
						operatorCode: operatorCode || "",
						businessName: businessName || "",
						branchName: branchName || "",
						outletName: outletName || "",
						operatorCity: operatorCity || "",
						operatorRegion: operatorRegion || "",
						ip: clientIp,
						device: `${userDevice.osName} ${userDevice.deviceType} ${userDevice.brand} ${userDevice.clientType} ${userDevice.clientName}`
					}
				};

				ctx.call("transactions.mainRequest", { payload: params });
				ctx.call("analytics.usage", { payload: params.payload, runAnalytics: env["enable-analytics"] });

				return {
					message: await this.aesEncrypt({ success: true }, publicKey)
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