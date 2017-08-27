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
        bot.replyPrivate(msg, { text : userMessage.help });
        return;
      }

      (async() => {
        const key = Date.now(); // to set unique value
        const data = await getChannelDataFromStorage(msg.channel);
        data[key] = { text : msg.text, temporary : true }; // save message text
        await util.promisify(controller.storage.channels.save) (data);

        const attachments = [
          new kidokuAttachment.kidoku(msg.text,
            await util.promisify(botUser.api.users.info) ({ user : msg.user_id }),
            { callback_id : 'preview' }), // set dummy callback_id
          new kidokuAttachment.confirm(key)
        ];
        bot.replyPrivate(msg, { text : userMessage.preview, attachments });
      })().catch((err) => {
        console.error(new Error(err));
        bot.replyPrivate(msg, { text : userMessage.error.default });
      });
    }
  });

  controller.on('interactive_message_callback', (bot, msg) => {
    if(msg.callback_id !== 'slack-kidoku') { return; }

    (async() => {
      const data = await getChannelDataFromStorage(msg.channel);
      let key;

      if(msg.actions[0].name === 'cancel') {
        bot.replyInteractive(msg, { text : userMessage.cancel });
      }

      else if(msg.actions[0].name === 'ok') {
        key = msg.text;
        const attachments = [
          new kidokuAttachment.kidoku(data[key].text, await util.promisify(botUser.api.users.info) ({ user : msg.user }))
        ];

        const message = { channel : msg.channel, attachments, link_names : true };
        const result = await util.promisify(botUser.api.chat.postMessage) (message);
        bot.replyInteractive(msg, { delete_original : true });

        const tsMicroSec = result.ts * 1e6;
        const messageUrl = `https://${msg.team.domain}.slack.com/archives/${msg.channel}/p${tsMicroSec}`;
        data[tsMicroSec] = { read_user : [], all_user : [], message_url : messageUrl };
        const channelMention = result.message.attachments[0].text.match(/<!(.*?)>/g);
        const userMention = result.message.attachments[0].text.match(/<@(.*?)>/g);
        if(!channelMention && userMention) { // if user mention only
          data[tsMicroSec].all_user = userMention.reduce((res, user) => [...res, user.substr(2, user.length - 3)], []); // <@U.*?> -> U.*?
        }
        else {
          const apiChannelsInfo = (msg.channel[0] === 'C') ? botUser.api.channels.info : botUser.api.groups.info; // channel or group
          const channelsInfo = await util.promisify(apiChannelsInfo) ({ channel : msg.channel });
          const members = (msg.channel[0] === 'C') ? channelsInfo.channel.members : channelsInfo.group.members;
          // exclude bot accounts
          const usersList = await util.promisify(botUser.api.users.list) ({});
          for(const member of usersList.members) {
            const index = members.indexOf(member.id);
            if(~index && (member.is_bot || member.deleted)) { members.splice(index, 1); }
          }
          data[tsMicroSec].all_user = members;
        }
      }

      else if(msg.actions[0].name === 'kidoku') {
        key = msg.message_ts * 1e6;
        if(data[key].read_user.indexOf(msg.user) >= 0) { // if the user already exists in read_user, delete them
          data[key].read_user = data[key].read_user.filter((val) => (val !== msg.user));
        }
        else { data[key].read_user.push(msg.user); } // if not, add them

        const attachments = [
          msg.original_message.attachments[0], // original text and button
          {
            title : `${userMessage.kidoku}(${data[key].read_user.length})`,
            text  : userArrayToMention(data[key].read_user)
          }
        ];
        bot.replyInteractive(msg, { attachments });
      }

      else if(msg.actions[0].name === 'show-unread') {
        key = msg.message_ts * 1e6;
        const unreader = data[key].all_user.filter((user) => !data[key].read_user.includes(user));
        bot.replyInteractive(msg, {
          text             : userArrayToMention(unreader) || userMessage.everyone_read,
          attachments      : [ new kidokuAttachment.unreader(unreader.length, key) ],
          response_type    : 'ephemeral',
          replace_original : false
        });
      }

      else if(msg.actions[0].name === 'remind') {
        key = msg.text;
        const unreaderObj = data[key].all_user
          .filter((user) => !data[key].read_user.includes(user))
          .reduce((res, cur) => Object.assign(res, { [ cur ] : cur }), {});

        const imList = await util.promisify(botUser.api.im.list) ({});
        for(const im of imList.ims) {
          if(unreaderObj[im.user]) {
            await util.promisify(bot.say) ({
              text    : `<@${msg.user}> ${userMessage.remind}\n${data[key].message_url}`,
              channel : im.id
            });
          }
        }

        bot.replyInteractive(msg, {
          text        : userMessage.sent_remind,
          attachments : [ new kidokuAttachment.reminded(`<@${msg.user}> ${userMessage.remind}\n${data[key].message_url}`) ]
        });
      }

      else if(msg.actions[0].name === 'close') {
        bot.replyInteractive(msg, { delete_original : true });
      }

      if(data[key] && data[key].temporary) { delete data[key]; }
      await util.promisify(controller.storage.channels.save) (data);

    })().catch((err) => {
      console.error(new Error(err));
      if(err === 'channel_not_found') {
        bot.replyInteractive(msg, { text : userMessage.error.bot_not_joined });
      }
      else {
        bot.replyInteractive(msg, { text : userMessage.error.default, response_type : 'ephemeral', replace_original : false });
      }
    });
  });

  const kidokuAttachment = {};

  kidokuAttachment.kidoku = function(text, usersInfo, option = {}) {
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
      }, {
        name : 'show-unread',
        text : userMessage.label.show_unread,
        type : 'button',
      }
    ];
  };

  kidokuAttachment.confirm = function(key) {
    this.fallback    = 'Confirmation of read confirmation button.',
    this.callback_id = 'slack-kidoku',
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

  kidokuAttachment.unreader = function(num, value) {
    this.fallback    = 'Unreader\'s information.',
    this.callback_id = 'slack-kidoku',
    this.title       = `${userMessage.unread}(${num})`,
    this.ts          = Date.now() / 1000,
    this.actions     = [];
    if(num) {
      this.actions.push({
        name    : 'remind',
        text    : userMessage.label.remind,
        value,
        type    : 'button',
        confirm : {
          text         : userMessage.confirm,
          ok_text      : userMessage.label.ok,
          dismiss_text : userMessage.label.cancel
        }
      });
    }
    this.actions.push({
      name : 'close',
      text : userMessage.label.close,
      type : 'button'
    });
  };

  kidokuAttachment.reminded = function(text) {
    this.fallback    = 'Detail of Reminder.',
    this.callback_id = 'slack-kidoku',
    this.text        = text,
    this.actions     = [{
      name : 'close',
      text : userMessage.label.close,
      type : 'button'
    }];
  };

  const userArrayToMention = (users) => users.reduce((pre, user) => `${pre}, <@${user}>`, '').slice(2, );

  const getChannelDataFromStorage = async(channel) => {
    const data = await util.promisify(controller.storage.channels.get) (channel)
      .catch((err) => {
        if(err.message !== 'could not load data') { throw new Error(err); }
    }) || { id : channel }; // if channel data not exist, create it
    return data;
  };
};

