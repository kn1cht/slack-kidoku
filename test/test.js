'use strict';

require('dotenv').config();
  const userMessage = (process.env.lang === 'en') ? require('../locales/en.json') : require('../locales/ja.json');

const assert = require('power-assert');
const botkitMock = require('botkit-mock');
const util = require('util');

const events = require('../events.js');
const controller = botkitMock({ debug : false, log : false });
const bot = controller.spawn({ type : 'slack' });

// fake api information
const info = {
  team_id    : 'T12345678',
  user_name  : 'fakeuser',
  user_id    : 'U12345678',
  user_id_2  : 'U98765432',
  botuser_id : 'U14285714',
  channel    : 'C12345678',
  group      : 'G12345678',
  im         : 'D12345678',
  text       : 'test message!'
};

const sequence = {
  command : function(opt = {}) {
    this.type     = 'slash_command',
    this.user     = info.user_id,
    this.channel  = opt.channel || info.channel,
    this.messages = [{
      isAssertion  : true,
      token        : '',
      channel_id   : opt.channel || info.channel,
      user_id      : info.user_id,
      command      : '/kidoku',
      text         : (opt.text !== void 0) ? opt.text : 'kidoku',
      response_url : 'https://hooks.slack.com/commands/foo/bar'
    }]
  },
  confirm : function(opt = {}) {
    this.type     = 'interactive_message_callback',
    this.user     = info.user_id,
    this.channel  = opt.channel || info.channel,
    this.messages = [{
      isAssertion  : true,
      token        : '',
      channel      : opt.channel || info.channel,
      user_id      : info.user_id,
      text         : info.text,
      callback_id  : 'slack-kidoku-confirm',
      actions      : [{ name : opt.name || 'ok', type : 'button', value : info.text }],
      response_url : 'https://hooks.slack.com/commands/foo/bar'
    }]
  },
  kidoku : function(opt = {}) {
    this.type     = 'interactive_message_callback',
    this.user     = opt.user || info.user_id,
    this.channel  = info.channel,
    this.messages = [{
      isAssertion      : true,
      token            : '',
      channel          : info.channel,
      user             : opt.user || info.user_id,
      text             : opt.text || '',
      callback_id      : 'slack-kidoku',
      actions          : [{ name : 'kidoku', type : 'button', value : opt.text || '' }],
      original_message : opt.original_message || {},
      response_url     : 'https://hooks.slack.com/commands/foo/bar'
    }]
  },
  unread : function(opt = {}) {
    this.type     = 'interactive_message_callback',
    this.user     = info.user_id,
    this.channel  = info.channel,
    this.messages = [{
      isAssertion      : true,
      token            : '',
      channel          : info.channel,
      user             : info.user_id,
      text             : opt.text || '',
      callback_id      : 'slack-kidoku',
      actions          : [{ name : 'show-unread', type : 'button', value : opt.text || '' }],
      original_message : opt.original_message || {},
      response_url     : 'https://hooks.slack.com/commands/foo/bar'
    }]
  }
}

function botInit() {
  bot.api.setData('users.info', {
    ok   : true,
    user : {
      name    : info.user_name,
      profile : {
        email    : 'tests@gmail.com',
        image_24 : 'https://...'
      }
    }
  });
  bot.api.setData('users.list', {
    ok      : true,
    members : [
      {
        id      : info.user_id,
        name    : info.user_name,
        is_bot  : false
      }, {
        id      : info.user_id_2,
        name    : info.user_name,
        is_bot  : false
      }, {
        id      : info.botuser_id,
        name    : info.user_name,
        is_bot  : true
      }
    ]
  });
  bot.api.setData('channels.info', {
    C12345678 : {
      ok      : true,
      channel : {
        id      : info.channel,
        name    : 'general',
        members : [ info.user_id, info.user_id_2, info.botuser_id ]
      }
    }
  });
  bot.api.setData('groups.info', {
    ok      : true,
    group   : {
      id      : info.group,
      name    : 'group',
      members : [ info.user_id, info.user_id_2, info.botuser_id ]
    }
  });
  bot.api.setData('chat.postMessage', {
    ok      : true,
    channel : info.channel,
    message : {
      attachments : [{ text : info.text }]
    }
  });
}

bot.replyPrivate = function(src, resp, cb) {
  let msg = {};
  if (typeof(resp) === 'string') {
    msg.text = resp;
  } else {
    msg = resp;
  }
  msg.channel = src.channel;
  if (src.thread_ts) {
    msg.thread_ts = src.thread_ts;
  }
  msg.response_type = 'ephemeral';
  const requestOptions = {
    uri    : src.response_url,
    method : 'POST',
    json   : msg
  };
  bot.api.callAPI('replyPrivate', requestOptions, (err) => {
    if (err) {
      console.error('Error sending interactive message response:', err);
      cb && cb(err);
    } else {
      cb && cb();
    }
  });
};

describe('slack-kidoku', function() {
  before(async() => {
    await util.promisify(controller.storage.channels.save) ({ id : 'foo' });// avoid storage error
    botInit();
    events(controller, bot);
  });
  after(() => {
    controller.shutdown();
  });
  describe('/kidoku command', () => {
    beforeEach(() => botInit);
    it('return confirm message', () => {
      return bot.usersInput([ new sequence.command() ]).then(() => {
        const reply = bot.api.logByKey['replyPrivate'].slice(-1)[0].json;
        assert(reply.attachments[0].callback_id === 'preview');
        assert(reply.attachments[1].callback_id === 'slack-kidoku-confirm');
      });
    });
    it('return error text when text was empty', () => {
      return bot.usersInput([ new sequence.command({ text : '' }) ]).then(() => {
        const reply = bot.api.logByKey['replyPrivate'].slice(-1)[0].json;
        assert(reply.text === userMessage.error.no_text);
        assert(!reply.attachments);
      });
    });
    it('return error text when command used in direct messages', () => {
      return bot.usersInput([ new sequence.command({ channel : info.im  }) ]).then(() => {
        const reply = bot.api.logByKey['replyPrivate'].slice(-1)[0].json;
        assert(reply.text === userMessage.error.command_in_dm);
        assert(!reply.attachments);
      });
    });
  });
  describe('confirm message buttons', () => {
    beforeEach(() => botInit);
    it('post kidoku button message to channel if ok button is pushed', () => {
      return bot.usersInput([ new sequence.confirm() ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === userMessage.success);
        const reply = bot.api.logByKey['chat.postMessage'].slice(-1)[0];
        assert(reply.attachments[0].callback_id === 'slack-kidoku');
        assert(reply.channel === info.channel);
        assert(reply.attachments[0].author_name === info.user_name);
        assert(reply.attachments[0].text === info.text);
      });
    });
    it('post kidoku button message to private group if ok button is pushed', () => {
      return bot.usersInput([ new sequence.confirm({ channel : info.group }) ]).then(() => {
        const reply = bot.api.logByKey['chat.postMessage'].slice(-1)[0];
        assert(reply.channel === info.group);
      });
    });
    it('show only cancel message if cancel button is pushed', () => {
      return bot.usersInput([ new sequence.confirm({ name : 'cancel' }) ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === userMessage.cancel);
      });
    });
    it('show error message if there is error', () => {
      bot.api.setData('chat.postMessage', {
        ok    : false,
        error : 'request_timeout'
      });
      return bot.usersInput([ new sequence.confirm() ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === userMessage.error.default);
      });
    });
    it('show special error message if there is channel_not_found error', () => {
      bot.api.setData('chat.postMessage', {
        ok    : false,
        error : 'channel_not_found'
      });
      return bot.usersInput([ new sequence.confirm() ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === userMessage.error.bot_not_joined);
      });
    });
  });
  describe('kidoku button', () => {
    let originalMessage, value;
    before(() => {
      originalMessage = bot.api.logByKey['chat.postMessage'][0];
      value = originalMessage.attachments[0].actions[0].value;
    });
    beforeEach(() => botInit);

    it('add name of who pushed kidoku button to original message', () => {
      return bot.usersInput([ new sequence.kidoku({ original_message : originalMessage, text : value }) ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(JSON.stringify(replyInteractive.attachments[0]) === JSON.stringify(originalMessage.attachments[0]), 'buttons should remain same as previous');
        assert(replyInteractive.attachments[1].text === `<@${info.user_id}>`);
      });
    });
    it('concatenate username by comma if several users pushed button', () => {
      return bot.usersInput([ new sequence.kidoku({ original_message : originalMessage, text : value, user : info.user_id_2 }) ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(JSON.stringify(replyInteractive.attachments[0]) === JSON.stringify(originalMessage.attachments[0]), 'buttons should remain same as previous');
        assert(replyInteractive.attachments[1].text === `<@${info.user_id}>, <@${info.user_id_2}>`);
      });
    });
    it('delete username if it already exist in members who have pushed button', () => {
      return bot.usersInput([ new sequence.kidoku({ original_message : originalMessage, text : value }) ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(JSON.stringify(replyInteractive.attachments[0]) === JSON.stringify(originalMessage.attachments[0]), 'buttons should remain same as previous');
        assert(replyInteractive.attachments[1].text === `<@${info.user_id_2}>`);
      });
    });
  });
  describe('show unread button', () => {
    let originalMessage, value;
    before(() => {
      originalMessage = bot.api.logByKey['chat.postMessage'][0];
      value = originalMessage.attachments[0].actions[0].value;
    });
    beforeEach(() => botInit);

    it('show username of the members in the channel who have not pushed kidoku button yet', () => {
      return bot.usersInput([ new sequence.unread({ original_message : originalMessage, text : value }) ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === `<@${info.user_id}>`);
      });
    });
    it('show special message if all channel members have read message', async() => {
      await bot.usersInput([ new sequence.kidoku({ original_message : originalMessage, text : value }) ]);
      return bot.usersInput([ new sequence.unread({ original_message : originalMessage, text : value }) ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === userMessage.everyone_read);
      });
    });
    it('if user mentions were included in message, treat them as all user to read it', async() => {
      bot.api.setData('chat.postMessage', {
        ok      : true,
        channel : info.channel,
        message : {
          attachments : [{ text : '<@U77777777> <@U88888888> something important' }]
        }
      });
      await bot.usersInput([ new sequence.command() ]);
      await bot.usersInput([ new sequence.confirm() ]);
      originalMessage = bot.api.logByKey['chat.postMessage'].slice(-1)[0];
      value = originalMessage.attachments[0].actions[0].value;
      return bot.usersInput([ new sequence.unread({ original_message : originalMessage, text : value }) ]).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === '<@U77777777>, <@U88888888>');
      });
    });
  });
  describe('API error case:', () => {
    beforeEach(() => botInit);
    it('send default message (with users.info error)', async() => {
      bot.api.setData('users.info', {
        ok    : false,
        error : 'request_timeout'
      });
      return bot.usersInput([ new sequence.command() ]).then(() => {
        const reply = bot.api.logByKey['replyPrivate'].slice(-1)[0].json;
        assert(reply.text === userMessage.error.default);
      });
    });
    it('send default message (with channels.info error)', async() => {
      bot.api.setData('channels.info', {
        ok    : false,
        error : 'request_timeout'
      });
      return bot.usersInput([ new sequence.confirm() ]).then(() => {
        const reply = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(reply.text === userMessage.error.default);
      });
    });
  });
});
