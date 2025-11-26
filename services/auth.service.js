"use strict";

const fs = require("fs");
const path = require("path");

const env = require("../env.json");
const UtilitiesMixin = require("../mixins/utilities.mixin");
const RedisCacheMixin = require("../mixins/cache.mixin");
const publicKey = fs.readFileSync(path.resolve("./public.pem"), { encoding: "utf-8" });

let googleReptcha = env.googleReptchaAuth;
let googleSecret = env.reptchaSecretKey;
let enableWhiltelist = env.enableWhiltelist;

module.exports = {
	name    : "auth",

	settings: { 
		appName: "eef-teller-api" 
	},

	mixins: [ UtilitiesMixin, RedisCacheMixin ],

	actions : {
		authToken: {
			async handler (ctx) {
				let { payload: params } = ctx.params;
				let { data: payload, publicKey } = this.aesDecrypt(params);

				let logData = {
					type: "info",
					action: "fetch-token",
					service : ctx.service.fullName,
					requestParams: payload.username,
					requestId: payload.requestId,
					loginId: payload.loginId,
					responseData: "",
					userDevice: ctx.meta.userDevice
				};

				let feedback = {
					message: "Sign In request failed."
				};

				/** Recaptcha verification */

				let passedRecaptcha = await this.verifyRecaptcha(payload, ctx.meta.clientIp);
				logData.googleAuthResponse = passedRecaptcha;

				console.log({payload, passedRecaptcha});

				if(!passedRecaptcha.success){
					logData.type = "error-bot";
					ctx.emit( "create.log", logData);

					return {
						message: await this.aesEncrypt({
							message: "Login Failed. Try again.."
						}, publicKey)
					};
				}

				//whitelisting public users
				const whitelistKey = `${this.settings.appName}:config:whitelist`;
				const userExists = await this.RedisExistsInSet(whitelistKey, payload.username);
				if(enableWhiltelist && !userExists){
					logData.type = "error-access";
					ctx.emit( "create.log", logData);

					return {
						message: await this.aesEncrypt({
							message: "Login Failed. Try again.."
						}, publicKey)
					};
				}

				let ibLogin = await ctx.call("login.login", payload);
				if(ibLogin.success){
					
					feedback = { 
						...ibLogin	, 
						requestId	: payload.requestId, 
						token		: ibLogin.data.token
					};

					logData.responseData = "Login successful. Token generation successful";
				}else{
					feedback = { 
						...ibLogin	, 
						requestId	: payload.requestId 
					};

					logData.type = "debug";
					logData.responseData = `Login failed. ${ibLogin.message}`;
				}

				ctx.emit("create.log", logData);

				return {
					message: await this.aesEncrypt(feedback, publicKey)
				};
			}
		},
		verify: {
			rest: "/verify-token",
			params: {
				token : "string"
			},
			async handler ( ctx ) {

				let logData = {
					type: "info",
					service : ctx.service.fullName,
					action: "verify-token",
					requestData: "",
					userDevice: ctx.meta.userDevice
				};

				let user = this.verifyToken(ctx.params.token);

				logData.responseData = user;
				if(!user){
					logData.type = "debug";
					logData.requestData = ctx.params.token;
					ctx.emit("create.log", logData);
				}

				return user;
				
			}
		},
		getPublicKey: {
			async handler () {
				let apiKey = Buffer.from(publicKey).toString("base64");

				return apiKey;
			}
		}
	},

	methods: {
		async verifyRecaptcha (payload, clientIp) {
			let success = false;

			let res = await this.httpFetch(
				"post",
				`${googleReptcha}?secret=${googleSecret}&response=${payload.recaptchaToken}&remoteip=${clientIp}`,
				{ }
			);
			success = res.data.success; //res?.data?.success

			return { success, data: res.data };
		}
	}
};