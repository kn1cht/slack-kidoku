// utd-8
'use strict';

const Botkit = require('botkit');
const config = require('config');

const controller = Botkit.slackbot({
  json_file_store : './bot_db/'
}).configureSlackApp({
  clientId     : config.clientId || '',
  clientSecret : config.clientSecret || '',
  scopes       : ['bot', 'commands']
});

controller.setupWebserver(3000, () => {
  controller.createWebhookEndpoints(controller.webserver);
  controller.createOauthEndpoints(controller.webserver, (err, req, res) => {
    console.log('OAuth requested');
    if(err) { res.status(500).send('ERROR: ' + err); }
    else { res.send('Success!'); }
  });
});

function kidokuButton(text, author) {
  this.fallback        = 'Read confirmation button.';
  this.callback_id     = 'slack-kidoku';
  this.color           = 'good';
  this.attachment_type = 'default';
  this.text            = text;
  this.actions         = [
    {
      name  : 'kidoku',
      text  : '既読',
      type  : 'button',
      style : 'primary'
    }
  ];
  this.footer          = author;
}

function kidokuConfirm(text, author) {
  this.fallback        = 'Confirmation of read confirmation button.';
  this.callback_id     = 'slack-kidoku-confirm';
  this.attachment_type = 'default';
  this.title           = '既読ボタンを作成します';
  this.actions         = [
    {
      name  : 'ok',
      text  : 'OK',
      type  : 'button',
      value : JSON.stringify({
        author : author,
        text   : text
      }),
      style : 'primary'
    },
    {
      name  : 'cancel',
      text  : 'Cancel',
      type  : 'button',
      style : 'danger'
    }
  ];
}

controller.on('slash_command', (bot, src) => {
  console.log(src);
  if(src.command === '/kidoku') {
    const reply = {
      text        : 'Preview:',
      attachments : [
        new kidokuButton(src.text, src.user_name),
        new kidokuConfirm(src.text, src.user_name)
      ],
    };
    bot.replyPrivate(src, reply);
  }
});

controller.on('interactive_message_callback', (bot, src) => {
  console.log(src);
  if (src.callback_id === 'slack-kidoku-confirm') {
    const name = src.actions[0].name;
    if (name === 'ok') {
      const value = JSON.parse(src.actions[0].value);
      bot.replyInteractive(src, { text : 'Success!' });
      controller.spawn({
        token : config.botToken || ''
      }).startRTM((err, bot) => {
        if (err) { throw new Error('Could not connect to Slack'); }
        bot.say({
          attachments : [new kidokuButton(value.text, value.author)],
          channel     : src.channel
        });
      });
    }
    else if (name === 'cancel') {
      bot.replyInteractive(src, { text : 'Canceled :wink:' });
    }
  }
});
