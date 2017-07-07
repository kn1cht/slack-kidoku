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

controller.on('slash_command', (bot, src) => {
  console.log(src);
  if(src.command === '/kidoku') {
    usersInfo(src.user_id).then((res) => {
      const attachments = [
        new KidokuButton(src.text, res.user.name, res.user.profile.image_24),
        new KidokuConfirm(src.text)
      ];
      bot.replyPrivate(src, { text : 'Preview:', attachments : attachments });
    }).catch((err) => {
      console.error(err);
    });
  }
});

controller.on('interactive_message_callback', (bot, src) => {
  console.log(src);
  if (src.callback_id === 'slack-kidoku-confirm') {
    if (src.actions[0].name === 'ok') {
      bot.replyInteractive(src, { text : 'Success!' });
      postKidokuButtonToChannel(src.actions[0].value, src.user, src.channel);
    }
    else if (src.actions[0].name === 'cancel') {
      bot.replyInteractive(src, { text : 'Canceled :wink:' });
    }
  }
  else if (src.callback_id === 'slack-kidoku') {
    const attachments = src.original_message.attachments;
    attachments[0].fields = [{
      "title": "既読",
      "value": src.user
    }];
    console.log(attachments);
    bot.replyInteractive(src, { attachments : attachments });
  }
});

const KidokuButton = function(text, name, icon) {
  this.fallback        = 'Read confirmation button.';
  this.callback_id     = 'slack-kidoku';
  this.color           = 'good';
  this.attachment_type = 'default';
  this.author_name     = name;
  this.author_icon     = icon;
  this.text            = text;
  this.actions         = [
    { name : 'kidoku', text : '既読', type : 'button', style : 'primary' }
  ];
};

const KidokuConfirm = function(text) {
  this.fallback        = 'Confirmation of read confirmation button.';
  this.callback_id     = 'slack-kidoku-confirm';
  this.attachment_type = 'default';
  this.title           = '既読ボタンを作成します';
  this.actions         = [
    { name : 'ok', text : 'OK', type : 'button', value : text, style : 'primary' },
    { name : 'cancel', text : 'Cancel', type : 'button', style : 'danger' }
  ];
};

function usersInfo(userId) {
  return new Promise((resolve, reject) => {
    controller.spawn({ token : config.botToken || '' })
    .api.users.info({ user : userId }, (err, response) => {
      if(err) { reject(err); }
      else { resolve(response);  }
    });
  });
}

function postKidokuButtonToChannel(text, userId, channel) {
  usersInfo(userId).then((res) => {
    const attachments = [
      new KidokuButton(text, res.user.name, res.user.profile.image_24),
    ];
    controller.spawn({ token : config.botToken || '' })
    .startRTM((err, bot) => {
      if (err) { throw new Error('Could not connect to Slack'); }
      bot.say({ attachments : attachments, channel : channel });
    });
  }).catch((err) => {
    console.error(err);
  });
}
