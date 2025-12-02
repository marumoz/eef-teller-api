"use strict";

const RedisCacheMixin   = require("./cache.mixin");
const UtilitiesMixin    = require("./utilities.mixin");
const env               = require("../env.json");
const moment 		    = require("moment");

const sessionExpiry    = env.sessionExpiryInSeconds;

module.exports = {
	name: "session_mixin",

	mixins: [ 
		RedisCacheMixin, 
		UtilitiesMixin 
	],

	methods: {
		async setloginSession ({ appName, username, userData, floatAccount, token, ipAddress }) {
			let key = [ appName, "appclients", username ].join(":");
        
			let login_data = { 
				"ipAddress": ipAddress,
				"accessToken": token,
				"username": username,
				"timestamp": moment().format(),
				"accountDetails": userData,
				"floatAccount": floatAccount,
				"requestDetails": {}
			};
			let secureUserData = this.secureUserData( login_data );
			await this.RedisInsert( key, secureUserData, sessionExpiry );

			return {
				success: true
			};
		},
		async tokenAuthentication ({ appName, username, ipAddress, userToken, userTokenId }){
			let key             = [ appName, "appclients", username ].join(":");
			let keys            = [ key ];
			let redis_data      = await this.RedisGetMany(keys);
			let isAuthenticated = { userData: {} };
    
			try {
				let user_data    = redis_data[`${username}`];
				user_data        = this.retrieveUserData(user_data);

				let sessionIpAddress  = user_data["ipAddress"];
				let sessionId    = user_data["username"];
				let sessionToken = user_data["accessToken"];

				// console.log(JSON.stringify({userToken, ipAddress, username, userTokenId, sessionToken, sessionIpAddress, sessionId, redisData: user_data}, null, 4));

				if( userToken === sessionToken && 
                    ipAddress === sessionIpAddress.toString() && 
                    username === sessionId.toString() && 
                    userTokenId === sessionId.toString()
				){
					isAuthenticated = {
						success: true,
						userData: user_data
					};
				}

			} catch (error) {
				console.error(error);
			}
    
			return isAuthenticated;
		},
		async fetchCacheSession ({ appName, username }){
			let key             = [ appName, "appclients", username ].join(":");
			let keys            = [ key ];
			let redis_data      = await this.RedisGetMany(keys);
			let isAuthenticated = { userData: {} };
    
			try {
				let user_data    = redis_data[`${username}`];
				user_data        = this.retrieveUserData(user_data);

				if(user_data){
					isAuthenticated = {
						success: true,
						userData: user_data
					};
				}

			} catch (error) {
				console.error(error);
			}
    
			return isAuthenticated;
		}
	}
};