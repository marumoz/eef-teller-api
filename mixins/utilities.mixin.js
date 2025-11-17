"use strict";

const securePin         = require("secure-pin");
const CryptoJS          = require( "crypto-js" );
const jwt               = require( "jsonwebtoken");
const uniqid 		    = require("uniqid");
const fs                = require("fs");
const path              = require("path");
const crypto            = require("crypto");

const env               = require("../env.json");
const encryptionKeys    = env.encryption;
const apiTimeout        = env.api.timeout;
const JWT_SECRET        = env.encryption.JWT_SECRET;
const API_SECRET        = encryptionKeys.API_SECRET;
const storedApiKey      = fs.readFileSync(path.resolve("./private.pem"), { encoding: "utf-8" });

module.exports = {
	name: "utilities_mixin",

	methods: {
		fastEncrypt (message){
			let encrypted = message;
			if(typeof message === "object"){
				message = JSON.stringify(message);
			}
			try {
				encrypted = CryptoJS.AES.encrypt(
					message, 
					CryptoJS.enc.Utf8.parse(API_SECRET), 
					{ 
						mode: CryptoJS.mode.ECB, 
						formatter: CryptoJS.enc.Base64
					}
				).toString();
			} catch (error) {
				console.error(message, error);
			}
    
			return encrypted;
		},
		fastDecrypt (message) {
			let decrypted = message;
			try {
				decrypted  = CryptoJS.AES.decrypt(
					message.toString(), 
					CryptoJS.enc.Utf8.parse(API_SECRET), 
					{ 
						mode: CryptoJS.mode.ECB, 
						formatter: CryptoJS.enc.Base64
					}
				).toString(CryptoJS.enc.Utf8);
			} catch (error) {
				console.error(message, error);
			}
    
			try {
				decrypted = JSON.parse( decrypted );
			}catch ( e ) {
				// console.error(decrypted, e);
			}
    
			return decrypted;
		},
		signToken(data){
			let token = jwt.sign(
				{ data, jwtid: uniqid.process().toUpperCase() }, 
				JWT_SECRET,
				{ algorithm: "HS512", expiresIn: "45m" }
			);
        
			return token;
		},
		verifyToken(token){
			let decoded = false;

			try {

				decoded = jwt.verify( token, JWT_SECRET, { algorithms: "HS512" } );
			}catch ( e ) {
				console.error( e.message );
			}

			return decoded;
		},
		filterNullsFromObj(obj){
			let filtered = {};
			let keys = Object.keys (obj);
    
			for ( let key of keys ) {
				if( key && obj[key] !== null ){
					filtered [key.toLowerCase()] = obj[key];
				}
			}
    
			return filtered;
		},
		base64(payload) {
			let payloadToBase64 = payload;
			try {
				payloadToBase64 = JSON.stringify(payloadToBase64);
			} catch (error) {console.error(error);}
    
			payloadToBase64 = Buffer.from(payloadToBase64).toString("base64");
			return payloadToBase64;
		},
		base64Decode(payload) {	
			let payloadFromBase64 = Buffer.from(payload, "base64").toString("utf-8");
			return payloadFromBase64;
		},
		timeStamp(arg = "YYYY-MMM-DDTHH:MM:ss") {
			try {
				let moment = require("moment");
				let formatted = moment().format(arg);
				return formatted;
			}
			catch (e) {
				return false;
			}
		},
		JSON(data) {
			return JSON.stringify(data);
		},
		fromJSON(data) {
			try {
				return JSON.parse(data);
			}
			catch (e) {
				return data;
			}
		},
		//-TODO:format nested objects
		XML(data) {
			let xml = false;
			if (typeof (data) === "object") {
				xml = "<?xml version= \"1.0\" encoding=\"utf-8\"?>\n<message>";
				let keys = Object.keys(data);
				for (let key of keys) {
					xml += `\n\t<${key}>${data[key]}</${key}>`;
				}
				xml += "\n</message>";
			}
			return xml;
		},
		stan() {
			let randomInt = securePin.generatePinSync(6);
			return randomInt;
		},
		transactionId() {
			let uniqid = require("uniqid");
			return uniqid.process().toUpperCase();
		},
		encryptedPin(){
			let pin = securePin.generatePinSync(4);
			let encryptedPin = this.aesEncrypt(pin);
    
			return {
				pin,
				encryptedPin
			};
    
		},
		hashedPin(param){
			let pin = securePin.generatePinSync(4);
			let hashedPin = CryptoJS.HmacSHA256(Buffer.from(pin + param).toString("base64"), encryptionKeys.pinSecret ).toString(CryptoJS.enc.Hex);
    
			return {
				pin,
				hashedPin
			};
		},
		internationalPhoneNumber(phone){
			if ( phone.startsWith ( "0" ) && phone.length === 10 ) {
				phone = "254" + phone.slice(1);
			}
			return phone;
		},
		secureUserData(data){
			let sData = {};
			let dataKeys = Object.keys(data);
			for(let i of dataKeys){
				if(typeof data[i] === "boolean"){
					data[i] = data[i].toString();
				}
				if(typeof data[i] === "number"){
					data[i] = data[i].toString();
				}
				sData[i] = this.fastEncrypt(data[i]);
			}
			return sData;
		},
		retrieveUserData(data){
			let sData = {};
			let dataKeys = Object.keys(data);
			for(let i of dataKeys){
				sData[i] = this.fastDecrypt(data[i]);
				if(sData[i] === "true"){
					sData[i] = true;
				}
				if(sData[i] === "false"){
					sData[i] = false;
				}
			}
			return sData;
		},
		async importPublicKey (publicKey) {
			let extractKey = await crypto.webcrypto.subtle.importKey(
				"jwk", 
				publicKey, 
				{
					name: "RSA-OAEP",
					hash: "SHA-256"
				}, 
				false, 
				["encrypt"]
			);

			return extractKey;
		},
		generateRandomkeyAndIv() {
			const key = crypto.randomBytes(32); // For AES-256, key size is 32 bytes (256 bits)
			const iv = crypto.randomBytes(16); // For AES, block size is 16 bytes (128 bits)
			return { key, iv };
		},
		bufferToHex(buffer) {
			return Array.from(new Uint8Array(buffer))
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
		},
		encryptPayload ({ key, iv, message }) {
			const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
			let encrypted = cipher.update(message, "utf8", "hex");
			encrypted += cipher.final("hex");
			return encrypted;
		},
		async aesEncrypt ( message, publicKey ) {         
			if(typeof message === "object"){
				message = JSON.stringify(message);
			}
			let encrypted = "";

			try {
				let { key, iv } = this.generateRandomkeyAndIv();

				let encData = this.encryptPayload({ key, iv, message });
                
				let keyHex = this.bufferToHex(key);
				let ivHex = this.bufferToHex(iv);
  
				//RSA encryption of the AES keys
				let encryptedKeys = await this.rsaEncryption({ 
					publicKey: JSON.parse(publicKey), 
					data: JSON.stringify({ 
						secretKey: keyHex, 
						secretIv: ivHex 
					}) 
				});

				encrypted = {
					secureKeys: encryptedKeys,
					data: encData
				};

				key = null;
				iv = null;
				keyHex = null;
				ivHex = null;

			} catch (error) {
				console.error(error);
			}
    
			return encrypted;
            
		},
		dataDecryption ({ decryptedKeys, data }) {
			const keyBuffer = Buffer.from(decryptedKeys.secretKey, "hex");
			const ivBuffer = Buffer.from(decryptedKeys.secretIv, "hex");
			const encryptedDataBuffer = Buffer.from(data, "hex");

			// Function to decrypt data
			const decipher = crypto.createDecipheriv("aes-256-cbc", keyBuffer, ivBuffer);
			let decrypted = decipher.update(encryptedDataBuffer, null, "utf8");
			decrypted += decipher.final("utf8");

			return decrypted;
		},
		async rsaEncryption ({ publicKey, data }) {
			let extractedKey = await this.importPublicKey(publicKey);
			let encryptedData = crypto.publicEncrypt(
				{
					key: extractedKey,
					padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
					oaepHash: "sha256"
				},
				Buffer.from(data)
			).toString("base64");

			return encryptedData;
		},
		rsaDecryption (data) {
			let decryptedData = crypto.privateDecrypt(
				{
					key: storedApiKey,
					passphrase: encryptionKeys.RSA_KEY,
					oaepHash: "sha256",
					padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
				},
				Buffer.from(data, "hex")
			).toString("utf8");

			return decryptedData;
		},
		aesDecrypt ( message ) {
			let decrypted = "";
			let { secureKeys, data, publicKey } = message;

			try {
				let decryptedKeys = this.rsaDecryption(secureKeys);
				decryptedKeys = JSON.parse(decryptedKeys);
				decrypted = this.dataDecryption({ decryptedKeys, data });
                
			} catch (error) {
				console.error(error);
			}
    
			try {
				decrypted = JSON.parse( decrypted );
			}catch ( e ) {
				console.error(e);
			}
    
			return { data: decrypted, publicKey };
		},
		async httpFetch  (method, url, data, custom_headers = {}){

			const axios               = require("axios");
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
			
			instance.defaults.timeout = this.settings.apiTimeout || apiTimeout;
			
			//add headers if enabled
			let header_config = {};
			if (custom_headers) {
				header_config = {
					headers: custom_headers
				};
			}
			
			try {
				switch (method) {
					case "get":
						try {
							response = await instance.get( url, qs.stringify(data), header_config );
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
			}catch (e) {
				console.error(e);
				return {
					success: false,
					code,
					data: result
				};
			}
			
		}
	}
};