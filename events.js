// utf-8
'use strict';
const util = require('util');
const userMessage = (process.env.lang === 'en') ? require('./locales/en.json') : require('./locales/ja.json');

module.exports = (controller, botUser) => {
  controller.on('slash_command', (bot, msg) => {
    //console.log(msg);
    if(msg.command === '/kidoku') {
      if(msg.channel_id[0] === 'D') { // exclude request from DM
        bot.replyPrivate(msg, { text : userMessage.error.command_in_dm });
        return;
      }
      else if(!msg.text) {
        bot.replyPrivate(msg, { text : userMessage.error.no_text });
        return;
      }
      (async() => {
        const attachments = [
          await kidokuButton(msg.text, msg.user_id, { callback_id : 'preview' }), // set dummy id
          kidokuConfirm(msg.text)
        ];
        bot.replyPrivate(msg, { text : userMessage.preview, attachments : attachments });
      })().catch((err) => { console.error(err); });
    }
  });

  controller.on('interactive_message_callback', (bot, msg) => {
    //console.log(msg);
    if(msg.callback_id === 'slack-kidoku-confirm') {
      if(msg.actions[0].name === 'cancel') {
        bot.replyInteractive(msg, { text : userMessage.cancel });
      }
      else if(msg.actions[0].name === 'ok') {
        (async() => {
          const members = await getChannelUsers(msg.channel);
          const key = await saveKidukuButtonData(msg.channel, members);
          const message = {
            channel     : msg.channel,
            attachments : [ await kidokuButton(msg.text, msg.user, { value : key }) ],
            link_names  : true
          };
          const result = await util.promisify(botUser.api.chat.postMessage) (message);
          bot.replyInteractive(msg, { text : userMessage.success });

          const text = result.message.attachments[0].text;
          const channelMention = text.match(/<!(.*?)>/g);
          const userMention = text.match(/<@(.*?)>/g);
          if(!channelMention && userMention) {
            const data = await util.promisify(controller.storage.channels.get) (msg.channel);
            data[key].all_user = userMention.reduce((res, user) => [...res, user.substr(2, user.length - 3)], []); // <@U*********> -> U*********
            await util.promisify(controller.storage.channels.save) (data);
          }
        })().catch((err) => {
          console.error(err);
          if(err === 'channel_not_found') {
            bot.replyInteractive(msg, { text : userMessage.error.bot_not_joined });
          }
          else {
            bot.replyInteractive(msg, { text : userMessage.error.default });
          }
        });
      }
    }
    else if(msg.callback_id === 'slack-kidoku') {
      (async() => {
        const data = await util.promisify(controller.storage.channels.get) (msg.channel);
        const item = data[msg.text];
        if(msg.actions[0].name === 'kidoku') {
          if(item.read_user.indexOf(msg.user) >= 0) { // if the user already exists in read_user, delete them
            item.read_user = item.read_user.filter((val) => (val !== msg.user));
          }
          else { item.read_user.push(msg.user); } // if not, add them
          data[msg.text] = item;
          await util.promisify(controller.storage.channels.save) (data);

          const attachments = [ msg.original_message.attachments[0] ]; // original text and button
          attachments.push({
            title : `${userMessage.kidoku}(${item.read_user.length})`,
            text  : item.read_user.reduce((pre, user) => `${pre}, <@${user}>`, '').slice(2, ) // concatenate user mentions
          });
          bot.replyInteractive(msg, { attachments : attachments });
        }
        else if(msg.actions[0].name === 'show-unread') {
          const unreadUser = item.all_user.filter((user) => !item.read_user.includes(user));
          const text = unreadUser.reduce((pre, user) => `${pre}, <@${user}>`, '').slice(2, ); // concatenate user mentions
          bot.replyInteractive(msg, { text : text || userMessage.everyone_read, response_type : 'ephemeral', replace_original : false });
        }
      })().catch((err) => { console.error(err); });
    }
  });

  const kidokuButton = (text, userId, option) => {
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
          { name : 'kidoku', text : userMessage.label.kidoku, type : 'button', style : 'primary', value : option.value || '' },
          { name : 'show-unread', text : userMessage.label.show_unread, type : 'button', value : option.value || '' }
        ]
      };
    })().catch((err) => { console.error(err); });
  };

  const kidokuConfirm = (text) => {
    return {
      fallback        : 'Confirmation of read confirmation button.',
      callback_id     : 'slack-kidoku-confirm',
      attachment_type : 'default',
      title           : userMessage.create_confirm,
      actions         : [
        { name : 'ok', text : userMessage.label.ok, type : 'button', value : text, style : 'primary' },
        { name : 'cancel', text : userMessage.label.cancel, type : 'button', style : 'danger' }
      ]
    };
  };

  function getChannelUsers(channel) {
    return (async() => {
      let members = [];
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
      return members;
    })().catch((err) => { console.error(err); });
  }

  function saveKidukuButtonData(channel, members) {
    return (async() => {
      const key = Date.now(); // to set unique value
      let data;
      try { data = await util.promisify(controller.storage.channels.get)(channel); }
      catch(err) { console.error(err); }
      data = data || { id : channel }; // if data not yet exist, create
      data[key] = { read_user : [], all_user : members }; // add new item
      await  util.promisify(controller.storage.channels.save) (data);
      return key;
    })().catch((err) => { console.error(err); });
  }
};
