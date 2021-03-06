/*
*   app.js - CLI PoC
*   
*/
const util = require('util');
const { uuid, jsonSchema } = require('uuidv4');
const fetch = require('node-fetch');
const fetchHTML = require('fetch-cookie')(fetch);
const qrcode = require('qrcode-terminal');
const jose = require('node-jose');
const { program, opts } = require('commander');

const config = require('../server/config');
const utils = require('../utils/utils');

program
    .option('-f --fake','fake user - will fetch hard coded user - good for testing')
    .option('-n --none','no client authentication (default is JOSE)');

program.parse(process.argv);



// hard coded user for testing
const userMickey = config.page.uri + '/user/6d584122-69cd-47b3-9b0c-72dc90e9de4b';
const consent = config.page.uri + '/consent/ok';

async function fakeUser( startURI ) {

    let response = await fetchHTML(startURI);
    console.log('[FakeUser] '+response.url);
    console.log('[FakeUser] '+response.status);
    
    response = await fetchHTML(userMickey);
    console.log('[FakeUser] '+response.url);
    console.log('[FakeUser] '+response.status);
    
    response = await fetchHTML(consent);
    console.log('[FakeUser] '+response.url);
    console.log('[FakeUser] '+response.status);
};


async function  processResponse ( res ) {
    console.log(res.url);
    console.log(res.status);
    let json = await res.json();
    console.log( util.inspect(json,true,null) );
    return json;
}


( async function () {

    let grantRequest = JSON.stringify({
        iat: utils.now(),
        nonce: uuid(),
        uri: config.gs.uri,
        method: 'POST',
        client: {
            display: {
                name: "XAuth CLI PoC",
                uri: "https://github.com/dickhardt/XAuth-poc/wiki/CLI-App"
            }
        },
        interaction: {
            indirect: {
                information_uri: "https://github.com/dickhardt/XAuth-poc/wiki/CLI-App"
            },
            unknown_mode: 'this should generate a warning response'
        },
        authorizations: {
            type: "oauth_scope",
            scope: "read"
        },
        claims: {
            oidc: { 
                userinfo: {
                    name: null,
                    email: null
                }
            }
        }
    });

    var opt = {}
    if (program.none) {
        opt = {
            method:     'POST',
            body:       grantRequest,
            headers:    {   'Content-Type': 'application/json', 
                            'Accept':'application/json'
                        }
        }
    } else {
        var key = await jose.JWK.createKey('EC', 'P-256', { alg: 'ES256', use: 'sig'})
        let joseBody = await jose.JWS.createSign(
                                    {   format: 'compact',
                                        fields: {jwk: key.toJSON() } },
                                     key)
                                .update(grantRequest,"utf8")
                                .final();
        // check we can verify                            
        var test = await jose.JWS.createVerify()
                                .verify(joseBody, { allowEmbeddedKey: true });
        opt = {
            method: 'POST',
            body: joseBody,
            headers: {  'Content-Type': 'application/jose',
                        'Accept':'application/json'
                    }
        }    
    }

    let response = await fetch(config.gs.uri,opt);
    let json = await processResponse(response);

    console.log('\nScan and load the following QR Code:\n\n');
    qrcode.generate(json.interaction.indirect.indirect_uri,{small: true});

    if (program.fake)
        fakeUser( json.interaction.indirect.indirect_uri );

    // read grant        
    if (program.none) {
        opt = {headers:{'Accept':'application/json'}};
    } else {
        opt = {
            iat: utils.now(),
            nonce: uuid(),
            uri: json.uri,
            method: 'GET'
        };
        var joseHeader = await jose.JWS.createSign( {format:'compact'}, key)
            .update(JSON.stringify(opt),"utf8")
            .final();
        opt.headers = {
            'Accept':'application/json',
            'Authorization:': 'jose '+ joseHeader
         }
    }

    response = await fetch(json.uri, opts);

    json = await processResponse(response);

    if (!json.authorizations || !json.authorizations.token)
        return console.error('did not get authorizations');

        var azURI = json.authorizations.uri;


    // fetch resource w/ access token
    response = await fetch(config.resource.uri,
                            { headers: {
                                'Authorization': 'bearer '+ json.authorizations.token,
                                'Content-Type': 'application/json'
                            } });
    json = await processResponse(response);

    // refresh token        
    if (program.none) {
        opt = {headers:{'Accept':'application/json'}};
    } else {
        opt = {
            iat: utils.now(),
            nonce: uuid(),
            uri: azURI,
            method: 'GET'
        };
        var joseHeader = await jose.JWS.createSign( {format:'compact'}, key)
            .update(JSON.stringify(opt),"utf8")
            .final();
        opt.headers = {
            'Accept':'application/json',
            'Authorization:': 'jose '+ joseHeader
         }
    }

    response = await fetch(azURI, opts);

    json = await processResponse(response);


    if (!json.authorizations || !json.authorizations.token)
        return console.error('did not get authorizations');

    // fetch resource w/ access token
    response = await fetch(config.resource.uri,
                            { headers: {
                                'Authorization': 'bearer '+ json.authorizations.token,
                                'Content-Type': 'application/json'
                            } });
    json = await processResponse(response);
    


})();