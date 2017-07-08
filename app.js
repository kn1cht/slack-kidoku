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

const botUser = controller.spawn({ token : config.botToken || '' });

controller.setupWebserver(3000, () => {
  controller.createWebhookEndpoints(controller.webserver);
  controller.createOauthEndpoints(controller.webserver, (err, req, res) => {
    console.log('OAuth requested');
    if(err) { res.status(500).send('ERROR: ' + err); }
    else { res.send('Success!'); }
  });
});

controller.on('slash_command', async(bot, msg) => {
  console.log(msg);
  if(msg.command === '/kidoku') {
    const attachments = [
      await kidokuButton(msg.text, msg.user_id, { callback_id : 'preview' }), // set dummy id
      kidokuConfirm(msg.text)
    ];
    bot.replyPrivate(msg, { text : 'Preview:', attachments : attachments});
  }
});

controller.on('interactive_message_callback', async(bot, msg) => {
  console.log(msg);
  if (msg.callback_id === 'slack-kidoku-confirm') {
    if (msg.actions[0].name === 'ok') {
      const key = await saveKidukuButtondata(msg.channel);
      const attachments = [
        await kidokuButton(msg.text, msg.user, { value : key }),
      ];
      botUser.api.chat.postMessage({ channel : msg.channel, attachments : attachments, link_names : true }, (err) => {
        let resultText = 'Success!';
        if(err === 'channel_not_found') {
          resultText = 'Bot should be part of this channel or DM :persevere: \nPlease `/invite @kidoku` to use `/kidoku` command here.';
        }
        else if(err) { resultText = 'Sorry, something was wrong.'; }
        bot.replyInteractive(msg, { text : resultText });
      });
    }
    else if (msg.actions[0].name === 'cancel') {
      bot.replyInteractive(msg, { text : 'Canceled :wink:' });
    }
  }
  else if (msg.callback_id === 'slack-kidoku') {
    const attachments = [ msg.original_message.attachments[0] ]; // original text and button
    const data = await channelsGetPromise(msg.channel);
    const item = data[msg.text];
    if(item.read_user.indexOf(msg.user) >= 0) { // if the user already exists in read_user, delete them
      item.read_user = item.read_user.filter((val) => (val !== msg.user));
    }
    else { item.read_user.push(msg.user); } // if not, add them
    data[msg.text] = item;
    controller.storage.channels.save(data);
    attachments.push({
      title : `既読(${item.read_user.length})`,
      text  : item.read_user.reduce((pre, user) => `${pre}, <@${user}>`, '').slice(1, ) // concatenate user mentions
    });
    bot.replyInteractive(msg, { attachments : attachments });
  }
});

const kidokuButton = async(text, userId, option = {}) => {
  const info = await usersInfo(userId);
  return {
    fallback        : 'Read confirmation button.',
    callback_id     : option.callback_id || 'slack-kidoku',
    color           : 'good',
    attachment_type : 'default',
    text            : text,
    author_name     : info.user.name,
    author_icon     : info.user.profile.image_24,
    actions         : [
      { name : 'kidoku', text : '既読', type : 'button', style : 'primary', value : option.value || '' }
    ]
  };
};

const kidokuConfirm = (text) => {
  return {
    fallback        : 'Confirmation of read confirmation button.',
    callback_id     : 'slack-kidoku-confirm',
    attachment_type : 'default',
    title           : '既読ボタンを作成します',
    actions         : [
      { name : 'ok', text : 'OK', type : 'button', value : text, style : 'primary' },
      { name : 'cancel', text : 'Cancel', type : 'button', style : 'danger' }
    ]
  };
};

async function saveKidukuButtondata(channel) {
  const key = Date.now(); // to set unique value
  let data;
  try { data = await channelsGetPromise(channel); }
  catch(err) {
    if(err.message === 'could not load data') { data = { id : channel }; }
    else { throw new Error(err); }
  }
  data[key] = { read_user : [] }; // add new item
  await controller.storage.channels.save(data);
  return key;
}

function channelsGetPromise(channel) {
  return new Promise((resolve, reject) => {
    controller.storage.channels.get(channel, (err, channelData) => {
      if(err) { reject(err); }
      resolve(channelData);
    });
  });
}

function usersInfo(userId) {
  return new Promise((resolve, reject) => {
    botUser.api.users.info({ user : userId }, (err, response) => {
      if(err) { reject(err); }
      else { resolve(response); }
    });
  });
}
