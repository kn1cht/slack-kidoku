// utf-8
'use strict';

const Botkit = require('botkit');
const config = require('config');
const util = require('util');

const controller = Botkit.slackbot({
  json_file_store : './bot_db/'
}).configureSlackApp({
  clientId     : config.clientId || process.env.clientId || '',
  clientSecret : config.clientSecret || process.env.clientSecret || '',
  scopes       : ['bot', 'commands']
});

const botUser = controller.spawn({ token : config.token || process.env.token || '' });

controller.setupWebserver(process.env.PORT || 3000, () => {
  controller.createWebhookEndpoints(controller.webserver);
  controller.createOauthEndpoints(controller.webserver, (err, req, res) => {
    console.log('OAuth requested');
    if(err) { res.status(500).send('ERROR: ' + err); }
    else { res.send('Success!'); }
  });
});

controller.on('slash_command', (bot, msg) => {
  //console.log(msg);
  if(msg.command === '/kidoku') {
    if(msg.channel_id[0] === 'D') { // exclude request from DM
      bot.replyPrivate(msg, { text : ':x: `/kidoku` cannot be used in Direct messages!' });
      return;
    }
    else if(!msg.text) {
      bot.replyPrivate(msg, { text : ':x: Please specify your message!' });
      return;
    }
    (async() => {
      const attachments = [
        await kidokuButton(msg.text, msg.user_id, { callback_id : 'preview' }), // set dummy id
        kidokuConfirm(msg.text)
      ];
      bot.replyPrivate(msg, { text : 'Preview:', attachments : attachments });
    })().catch((err) => { console.error(err); });
  }
});

controller.on('interactive_message_callback', (bot, msg) => {
  //console.log(msg);
  if(msg.callback_id === 'slack-kidoku-confirm') {
    if(msg.actions[0].name === 'cancel') {
      bot.replyInteractive(msg, { text : 'Canceled :wink:' });
    }
    else if(msg.actions[0].name === 'ok') {
      (async() => {
        const members = await getChannelUsers(msg.channel);
        const key = await saveKidukuButtonData(msg.channel, members);
        const attachments = [
          await kidokuButton(msg.text, msg.user, { value : key }),
        ];
        const result = await util.promisify(botUser.api.chat.postMessage) ({ channel : msg.channel, attachments : attachments, link_names : true });
        bot.replyInteractive(msg, { text : 'Success!' });
      })().catch((err) => {
        console.error(err);
        if(err === 'channel_not_found') {
          bot.replyInteractive(msg, { text : 'Bot should be part of this channel or DM :persevere: \nPlease `/invite @kidoku` to use `/kidoku` command here.' });
        }
        else {
          bot.replyInteractive(msg, { text : 'Sorry, something went wrong.' });
        }
      });
    }
  }
  else if(msg.callback_id === 'slack-kidoku') {
    (async() => {
      const attachments = [ msg.original_message.attachments[0] ]; // original text and button
      const data = await util.promisify(controller.storage.channels.get)(msg.channel);
      const item = data[msg.text];
      if(item.read_user.indexOf(msg.user) >= 0) { // if the user already exists in read_user, delete them
        item.read_user = item.read_user.filter((val) => (val !== msg.user));
      }
      else { item.read_user.push(msg.user); } // if not, add them
      data[msg.text] = item;
      controller.storage.channels.save(data);
      attachments.push({
        title : `既読(${item.read_user.length}/${item.all_user.length})`,
        text  : item.read_user.reduce((pre, user) => `${pre}, <@${user}>`, '').slice(1, ) // concatenate user mentions
      });
      bot.replyInteractive(msg, { attachments : attachments });
    })().catch((err) => { console.error(err); });
  }
});

const kidokuButton = (text, userId, option = {}) => {
  return (async() => {
    const info = await util.promisify(botUser.api.users.info) ({ user : userId });
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
  })().catch((err) => { console.error(err); });
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

function getChannelUsers(channel) {
  let members = [];
  (async() => {
    if(channel[0] === 'C') { // channels
      const channelsInfo = await util.promisify(botUser.api.channels.info)({ channel : channel });
      members = channelsInfo.channel.members;
    }
    else if(channel[0] === 'G') { // groups or mpims
      const groupsInfo = await util.promisify(botUser.api.groups.info)({ channel : channel });
      members = groupsInfo.group.members;
    }
    // exclude bot accounts
    const usersList = await util.promisify(botUser.api.users.list) ({});
    for(const member of usersList.members) {
      const index = members.indexOf(member.id);
      if(member.is_bot && ~index) { members.splice(index, index); }
    }
  })().catch((err) => { console.error(err); });
  return members;
}

function saveKidukuButtonData(channel, members) {
  return (async() => {
    const key = Date.now(); // to set unique value
    let data;
    try { data = await util.promisify(controller.storage.channels.get)(channel); }
    catch(err) {
      if(err.message === 'could not load data') { data = { id : channel }; }
      else { throw new Error(err); }
    }
    data[key] = { read_user : [], all_user : members }; // add new item
    await controller.storage.channels.save(data);
    return key;
  })().catch((err) => { console.error(err); });
}
