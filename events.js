// utf-8
'use strict';
const util = require('util');
const userMessage = (process.env.lang === 'en') ? require('./locales/en.json') : require('./locales/ja.json');

module.exports = (controller, botUser) => {
  controller.on('slash_command', (bot, msg) => {
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
        const key = Date.now(); // to set unique value
        const data = await getChannelDataFromStorage(msg.channel);
        data[key] = { text : msg.text, temporary : true }; // save message text
        await util.promisify(controller.storage.channels.save) (data);

        const usersInfo = await util.promisify(botUser.api.users.info) ({ user : msg.user_id });
        const attachments = [
          new kidokuButton(msg.text, usersInfo, { callback_id : 'preview' }), // set dummy id
          new kidokuConfirm(key)
        ];
        bot.replyPrivate(msg, { text : userMessage.preview, attachments });
      })().catch((err) => {
        console.error(new Error(err));
        bot.replyPrivate(msg, { text : userMessage.error.default });
      });
    }
  });

  controller.on('interactive_message_callback', (bot, msg) => {
    if(msg.callback_id === 'slack-kidoku-confirm') {
      (async() => {
        const data = await getChannelDataFromStorage(msg.channel);

        if(msg.actions[0].name === 'cancel') {
          bot.replyInteractive(msg, { text : userMessage.cancel });
        }
        else if(msg.actions[0].name === 'ok') {
          const key = Date.now(); // to set unique value
          const usersInfo = await util.promisify(botUser.api.users.info) ({ user : msg.user });
          const message = {
            channel     : msg.channel,
            attachments : [ new kidokuButton(data[msg.text].text, usersInfo, { value : key }) ],
            link_names  : true
          };
          const result = await util.promisify(botUser.api.chat.postMessage) (message);
          bot.replyInteractive(msg, { delete_original : true });
          const text = result.message.attachments[0].text;
          const channelMention = text.match(/<!(.*?)>/g);
          const userMention = text.match(/<@(.*?)>/g);
          data[key] = { read_user : [], all_user : [] };
          if(!channelMention && userMention) { // if user mention only
            data[key].all_user = userMention.reduce((res, user) => [...res, user.substr(2, user.length - 3)], []); // <@U.*?> -> U.*?
          }
          else {
            data[key].all_user = await getChannelUsers(msg.channel);
          }
        }

        if(data[msg.text].temporary) { delete data[msg.text]; }
        await util.promisify(controller.storage.channels.save) (data);

      })().catch((err) => {
        console.error(new Error(err));
        if(err === 'channel_not_found') {
          bot.replyInteractive(msg, { text : userMessage.error.bot_not_joined });
        }
        else {
          bot.replyInteractive(msg, { text : userMessage.error.default });
        }
      });
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

          const attachments = [
            msg.original_message.attachments[0], // original text and button
            {
              title : `${userMessage.kidoku}(${item.read_user.length})`,
              text  : item.read_user.reduce((pre, user) => `${pre}, <@${user}>`, '').slice(2, ) // concatenate user mentions
            }
          ];
          bot.replyInteractive(msg, { attachments });
        }

        else if(msg.actions[0].name === 'show-unread') {
          const unreader = item.all_user.filter((user) => !item.read_user.includes(user));
          const text = unreader.reduce((pre, user) => `${pre}, <@${user}>`, '').slice(2, ); // concatenate user mentions
          bot.replyInteractive(msg, {
            text             : text || userMessage.everyone_read,
            attachments      : [ new kidokuUnreader(unreader.length) ],
            response_type    : 'ephemeral',
            replace_original : false
          });
        }

      })().catch((err) => {
        console.error(new Error(err));
        bot.replyInteractive(msg, { text : userMessage.error.default, response_type : 'ephemeral', replace_original : false });
      });
    }

    else if(msg.callback_id === 'slack-kidoku-unreader') {
      bot.replyInteractive(msg, { delete_original : true });
    }
  });

  const kidokuButton = function(text, usersInfo, option) {
    this.fallback    = 'Read confirmation button.',
    this.callback_id = option.callback_id || 'slack-kidoku',
    this.color       = '#4bb078',
    this.text        = text,
    this.mrkdwn_in   = [ 'text' ],
    this.author_name = usersInfo.user.name,
    this.author_icon = usersInfo.user.profile.image_24,
    this.actions     = [
      {
        name  : 'kidoku',
        style : 'primary',
        text  : userMessage.label.kidoku,
        type  : 'button',
        value : option.value || ''
      }, {
        name  : 'show-unread',
        text  : userMessage.label.show_unread,
        type  : 'button',
        value : option.value || ''
      }
    ];
  };

  const kidokuConfirm = function(key) {
    this.fallback    = 'Confirmation of read confirmation button.',
    this.callback_id = 'slack-kidoku-confirm',
    this.title       = userMessage.create_confirm,
    this.actions     = [
      {
        name  : 'ok',
        style : 'primary',
        text  : userMessage.label.ok,
        type  : 'button',
        value : key
      }, {
        name  : 'cancel',
        style : 'danger',
        text  : userMessage.label.cancel,
        type  : 'button',
        value : key
      }
    ];
  };

  const kidokuUnreader = function(num) {
    this.fallback    = 'Unreader\'s information.',
    this.callback_id = 'slack-kidoku-unreader',
    this.title       = `${userMessage.unread}(${num})`,
    this.ts          = Date.now() / 1000,
    this.actions     = [{
      name : 'close',
      text : userMessage.label.close,
      type : 'button'
    }];
  };

  const getChannelDataFromStorage = async(channel) => {
    let data;
    try {
      data = await util.promisify(controller.storage.channels.get) (channel);
    }
    catch(err) {
      if(err.message !== 'could not load data') { throw new Error(err); }
    }
    data =  data || { id : channel }; // if channel data not exist, create it
    return data;
  };

  const getChannelUsers = (channel) => {
    return (async() => {
      const apiChannelsInfo = (channel[0] === 'C') ? botUser.api.channels.info : botUser.api.groups.info; // channel or group
      const channelsInfo = await util.promisify(apiChannelsInfo) ({ channel });
      const members = (channel[0] === 'C') ? channelsInfo.channel.members : channelsInfo.group.members;
      // exclude bot accounts
      const usersList = await util.promisify(botUser.api.users.list) ({});
      for(const member of usersList.members) {
        const index = members.indexOf(member.id);
        if(member.is_bot && ~index) { members.splice(index, index); }
      }
      return members;
    })().catch((err) => { throw new Error(err); });
  };
};
