
( async () => {
    let api                 = require("./configs/api.json");
    let code                = require("./configs/code.json");
    let config              = require("./configs/config.json");
    let services            = require("./configs/services.json");
    
    let appName     = require("./env.json").appName;
    let connection  = require("./env.json").redis;
    const Redis     = require("ioredis");
    const chalk     = require("chalk");
    const moment    = require("moment");
    const figlet    = require("figlet");
    const clear     = require("clear");
    clear();
    
    
    let apiText =  (                            
        figlet.textSync(
            "API",
            "isometric3"
        )
    );
    console.log("Set initial configs script is running");
    console.log ( "\n\n",chalk.bold.white (apiText) );
    console.log ( "\n\nEclectics International ltd. All rights reserved.");
    console.log ( "+----------------------------------------------------+\n" );
    console.log ( chalk.green ( "API Dev Tool v7"     ) );
    console.log ( chalk.bold ( " [ Timestamp ]"     ) );
    console.log ( moment().format(" h:mm A : dddd DD MMM, Y"));
    console.log ( "\n+----------------------------------------------------+" );
    console.log ( chalk.green ( " REDIS CONNECTION"     ) );
    console.log(` REDIS HOST: ${chalk.green(`${connection.host}`)}`);
    console.log(` REDIS PORT: ${chalk.green(`${connection.port}`)}`);
    console.log(` REDIS DB  : ${chalk.green(`${connection.database}`)}`);
    console.log(` REDIS PASS: ${chalk.green(`${connection.password ? "*".repeat(connection.password.length) : ""}`)}`);
    console.log ( "\n+----------------------------------------------------+" );

    let client = new Redis({
        host          : connection.host, 
        port          : connection.port,
        no_ready_check: true,
        db            : connection.database,
        password      : connection.password                                                                                                                                                          
    });
    
    let valuesToJson = (data)=> {
        let jsonObj = {};
        try {
            let keys = Object.keys(data);
            for (let key of keys) {
                jsonObj[key] = JSON.stringify(data[key]);
            }
        }
        catch (e) { /* empty */ }
        return jsonObj;
    };
    let [ setApi, setCode, setConfig, setServices ] = await Promise.all([
        client.hmset(`${appName}:config:api`, valuesToJson(api)), 
        client.hmset(`${appName}:config:code`, valuesToJson(code)), 
        client.hmset(`${appName}:config:config`, valuesToJson(config)), 
        client.hmset(`${appName}:config:services`, valuesToJson(services))
    ]);
    
    console.log ( `\n\n ${chalk.yellow("(+)")} save:api : ${ chalk.green ( setApi ) }` );
    console.log ( ` ${chalk.yellow("(+)")} save:code : ${ chalk.green ( setCode ) }` );
    console.log ( ` ${chalk.yellow("(+)")} save:config : ${ chalk.green ( setConfig ) }` );
    console.log ( ` ${chalk.yellow("(+)")} save:services : ${ chalk.green ( setServices ) }` );

    client.disconnect();
    return true;
})();