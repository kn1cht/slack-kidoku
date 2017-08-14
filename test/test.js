'use strict';

require('dotenv').config();
const userMessage = (process.env.lang === 'en') ? require('../locales/en.json') : require('../locales/ja.json');

const assert = require('power-assert');
const botkitMock = require('botkit-mock');
const exec = require('child_process').exec;
const util = require('util');
Array.prototype.last = function() { return this.slice(-1)[0]; }; // get the last element

const events = require('../events.js');

const controller = botkitMock({
  debug           : false,
  log             : false,
  json_file_store : './test_db/'
});
const bot = controller.spawn({ type : 'slack' });

// fake api information
const info = {
  team_id     : 'T12345678',
  team_domain : 'test-team',
  user_name   : 'fakeuser',
  user_id     : 'U12345678',
  user_id_2   : 'U98765432',
  botuser_id  : 'U14285714',
  channel     : 'C12345678',
  group       : 'G12345678',
  im          : 'D12345678',
  text        : 'test message!',
  ts          : '1234567890.123456'
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
      text         : (opt.text !== void 0) ? opt.text : info.text,
      response_url : 'https://hooks.slack.com/commands/foo/bar'
    }];
  },
  button : function(name, opt = {}) {
    this.type     = 'interactive_message_callback',
    this.user     = opt.user || info.user_id,
    this.channel  = opt.channel || info.channel,
    this.messages = [{
      isAssertion      : true,
      token            : '',
      channel          : opt.channel || info.channel,
      team             : { domain : info.team_domain },
      message_ts       : info.ts,
      user             : opt.user || info.user_id,
      text             : opt.text || '',
      callback_id      : 'slack-kidoku',
      actions          : [{ name, type : 'button', value : opt.text || '' }],
      original_message : opt.original_message || {},
      response_url     : 'https://hooks.slack.com/commands/foo/bar'
    }];
  }
};

function botInit() {
  bot.api.setData('users.info', {
    ok   : true,
    user : {
      name    : info.user_name,
      profile : { email : 'tests@gmail.com', image_24 : 'https://...' }
    }
  });
  bot.api.setData('users.list', {
    ok      : true,
    members : [
      { id : info.user_id, name : info.user_name, is_bot : false },
      { id : info.user_id_2, name : info.user_name, is_bot : false },
      { id : info.botuser_id, name : info.user_name, is_bot : true }
    ]
  });
  bot.api.setData('channels.info', {
    C12345678 : {
      ok      : true,
      channel : {
        id      : info.channel,
        name    : 'general',
        members : [ info.botuser_id, info.user_id, info.user_id_2 ]
      }
    }
  });
  bot.api.setData('groups.info', {
    ok    : true,
    group : {
      id      : info.group,
      name    : 'group',
      members : [ info.botuser_id, info.user_id, info.user_id_2 ]
    }
  });
  bot.api.setData('chat.postMessage', {
    ok      : true,
    channel : info.channel,
    ts      : info.ts,
    message : { attachments : [{ text : info.text }] }
  });
  bot.api.setData('im.list', {
    ok  : true,
    ims : [
      {
        id    : info.im,
        is_im : true,
        user  : info.user_id
      }
    ]
  });
}

describe('slack-kidoku', function() {
  before(async() => {
    await util.promisify(controller.storage.channels.save) ({ id : 'foo' });// avoid storage error
    events(controller, bot);
  });
  after(() => {
    controller.shutdown();
    exec('rm -rf ./test_db');
  });

  describe('/kidoku command', () => {
    beforeEach(() => botInit());

    it('return confirm message', async() => {
      await bot.usersInput([ new sequence.command() ]);
      const reply = bot.api.logByKey['replyPrivate'].last().json;
      assert(reply.attachments[0].callback_id === 'preview');
      assert(reply.attachments[1].callback_id === 'slack-kidoku');
    });

    it('return error text when text was empty', async() => {
      await bot.usersInput([ new sequence.command({ text : '' }) ]);
      const reply = bot.api.logByKey['replyPrivate'].last().json;
      assert(reply.text === userMessage.error.no_text);
      assert(!reply.attachments);
    });

    it('return error text when command used in direct messages', async() => {
      await bot.usersInput([ new sequence.command({ channel : info.im }) ]);
      const reply = bot.api.logByKey['replyPrivate'].last().json;
      assert(reply.text === userMessage.error.command_in_dm);
      assert(!reply.attachments);
    });
  });

  describe('confirm message buttons', () => {
    beforeEach(() => botInit());

    it('post kidoku button message to channel if ok button is pushed', async() => {
      const key = bot.api.logByKey['replyPrivate'][0].json.attachments[1].actions[0].value;
      await bot.usersInput([ new sequence.button('ok', { text : key }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(replyInteractive.delete_original === true, 'original message should be deleted');
      const reply = bot.api.logByKey['chat.postMessage'].last();
      assert(reply.attachments[0].callback_id === 'slack-kidoku');
      assert(reply.channel === info.channel);
      assert(reply.attachments[0].author_name === info.user_name);
      assert(reply.attachments[0].text === info.text);
    });

    it('post kidoku button message to private group if ok button is pushed', async() => {
      await bot.usersInput([ new sequence.command({ channel : info.group }) ]);
      const key = bot.api.logByKey['replyPrivate'].last().json.attachments[1].actions[0].value;
      await bot.usersInput([ new sequence.button('ok', { text : key, channel : info.group }) ]);
      const reply = bot.api.logByKey['chat.postMessage'].last();
      assert(reply.channel === info.group);
    });

    it('show only cancel message if cancel button is pushed', async() => {
      await bot.usersInput([ new sequence.command() ]);
      const key = bot.api.logByKey['replyPrivate'].last().json.attachments[1].actions[0].value;
      await bot.usersInput([ new sequence.button('cancel', { text : key }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(replyInteractive.text === userMessage.cancel);
    });

    it('show error message if there is error', async() => {
      bot.api.setData('chat.postMessage', {
        ok    : false,
        error : 'request_timeout'
      });
      await bot.usersInput([ new sequence.command() ]);
      const key = bot.api.logByKey['replyPrivate'].last().json.attachments[1].actions[0].value;
      await bot.usersInput([ new sequence.button('ok', { text : key }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(replyInteractive.text === userMessage.error.default);
    });

    it('show special error message if there is channel_not_found error', async() => {
      bot.api.setData('chat.postMessage', {
        ok    : false,
        error : 'channel_not_found'
      });
      await bot.usersInput([ new sequence.command() ]);
      const key = bot.api.logByKey['replyPrivate'].last().json.attachments[1].actions[0].value;
      await bot.usersInput([ new sequence.button('ok', { text : key }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(replyInteractive.text === userMessage.error.bot_not_joined);
    });
  });

  describe('kidoku button', () => {
    let originalMessage;
    before(() => { originalMessage = bot.api.logByKey['chat.postMessage'][0]; });
    beforeEach(() => botInit());

    it('add name of who pushed kidoku button to original message', async() => {
      await bot.usersInput([ new sequence.button('kidoku', { original_message : originalMessage }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(JSON.stringify(replyInteractive.attachments[0]) === JSON.stringify(originalMessage.attachments[0]), 'buttons should remain same as previous');
      assert(replyInteractive.attachments[1].text === `<@${info.user_id}>`);
    });

    it('concatenate username by comma if several users pushed button', async() => {
      await bot.usersInput([ new sequence.button('kidoku', { original_message : originalMessage, user : info.user_id_2 }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(JSON.stringify(replyInteractive.attachments[0]) === JSON.stringify(originalMessage.attachments[0]), 'buttons should remain same as previous');
      assert(replyInteractive.attachments[1].text === `<@${info.user_id}>, <@${info.user_id_2}>`);
    });

    it('delete username if it already exist in members who have pushed button', async() => {
      await bot.usersInput([ new sequence.button('kidoku', { original_message : originalMessage }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(JSON.stringify(replyInteractive.attachments[0]) === JSON.stringify(originalMessage.attachments[0]), 'buttons should remain same as previous');
      assert(replyInteractive.attachments[1].text === `<@${info.user_id_2}>`);
    });
  });

  describe('show-unread button', () => {
    let originalMessage;
    before(() => { originalMessage = bot.api.logByKey['chat.postMessage'][0]; });
    beforeEach(() => botInit());

    it('show username of unreaders and show remind button', async() => {
      await bot.usersInput([ new sequence.button('show-unread', { original_message : originalMessage }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(replyInteractive.text === `<@${info.user_id}>`, 'bot account should not shown as unreader');
    });

    it('show special message if all channel members have read message', async() => {
      await bot.usersInput([ new sequence.button('kidoku', { original_message : originalMessage }) ]);
      await bot.usersInput([ new sequence.button('show-unread', { original_message : originalMessage }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(replyInteractive.text === userMessage.everyone_read);
    });

    it('if user mentions were included in message, treat them as all users who have to read it', async() => {
      bot.api.setData('chat.postMessage', {
        ok      : true,
        channel : info.channel,
        ts      : info.ts,
        message : {
          attachments : [{ text : `<@${info.user_id}> <@${info.user_id_2}> something important` }]
        }
      });
      await bot.usersInput([ new sequence.command() ]);
      const key = bot.api.logByKey['replyPrivate'].last().json.attachments[1].actions[0].value;
      await bot.usersInput([ new sequence.button('ok', { text : key }) ]);
      originalMessage = bot.api.logByKey['chat.postMessage'].last();
      await bot.usersInput([ new sequence.button('show-unread', { original_message : originalMessage }) ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(replyInteractive.text === `<@${info.user_id}>, <@${info.user_id_2}>`);
    });
  });

  describe('remind button', () => {
    let originalMessage;
    before(() => { originalMessage = bot.api.logByKey['chat.postMessage'][0]; });
    beforeEach(() => botInit());

    it('send remind messages to unreaders in direct messages', async() => {
      await bot.usersInput([ new sequence.button('remind', { text : info.ts * 1e6 }) ]);
      const message = bot.answers.last();
      assert(message.channel === info.im);
      assert(message.text ===
        `<@${info.user_id}> ${userMessage.remind}\nhttps://test-team.slack.com/archives/${info.channel}/p${info.ts * 1e6}`);
    });
  });

  describe('close button', () => {
    beforeEach(() => botInit());

    it('deletes original message', async() => {
      await bot.usersInput([ new sequence.button('close') ]);
      const replyInteractive = bot.api.logByKey['replyInteractive'].last().json;
      assert(replyInteractive.delete_original === true, 'original message should be deleted');
    });
  });

  describe('with API error', () => {
    beforeEach(() => botInit());

    it('send default error message (with users.info error)', async() => {
      bot.api.setData('users.info', {
        ok    : false,
        error : 'request_timeout'
      });
      await bot.usersInput([ new sequence.command() ]);
      const reply = bot.api.logByKey['replyPrivate'].last().json;
      assert(reply.text === userMessage.error.default);
    });

    it('send default error message (with users.list error)', async() => {
      bot.api.setData('users.list', {
        ok    : false,
        error : 'request_timeout'
      });
      await bot.usersInput([ new sequence.command() ]);
      const key = bot.api.logByKey['replyPrivate'].last().json.attachments[1].actions[0].value;
      await bot.usersInput([ new sequence.button('ok', { text : key }) ]);
      const reply = bot.api.logByKey['replyInteractive'].last().json;
      assert(reply.text === userMessage.error.default);
    });
  });
});
