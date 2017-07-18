// utf-8
'use strict';

const Botkit = require('botkit');
const config = require('config');

const controller = Botkit.slackbot({
  json_file_store : './bot_db/'
}).configureSlackApp({
  clientId     : config.clientId || process.env.clientId || '',
  clientSecret : config.clientSecret || process.env.clientSecret || '',
  scopes       : ['bot', 'commands']
});

controller.setupWebserver(process.env.PORT || 3000, () => {
  controller.createWebhookEndpoints(controller.webserver);
  controller.createOauthEndpoints(controller.webserver, (err, req, res) => {
    console.log('OAuth requested');
    if(err) { res.status(500).send('ERROR: ' + err); }
    else { res.send('Success!'); }
  });
});

require('./controller')(controller);
