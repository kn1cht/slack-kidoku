'use strict';

const assert = require('power-assert');
const botkitMock = require('botkit-mock');
const nock = require('nock');
const rewire = require('rewire');
const util = require('util');

const events = require('../events.js');

// fake api information
const info = {
  team_id : 'T12345678',
  user_name : 'fakeuser',
  user_id : 'U12345678',
  channel : 'C12345678',
  group   : 'G12345678',
  im      : 'D12345678',
  text    : 'test message!'
};

const controller = botkitMock({ debug : false });
const bot = controller.spawn({ type : 'slack' });
bot.api.setData('users.info', {
  ok   : true,
  user : {
    name    : info.user_name,
    profile : {
      email : 'tests@gmail.com',
      image_24 : 'https:\/\/...'
    }
  }
});
bot.api.setData('channels.info', {
  C12345678 : {
    ok      : true,
    channel : {
      id      : info.channel,
      name    : 'general',
      members : [ info.user_id ]
    }
  }
});
bot.api.setData('groups.info', {
  G12345678 : {
    ok      : true,
    channel : {
      id      : info.group,
      name    : 'group',
      members : [ info.user_id ]
    }
  }
});
bot.api.setData('chat.postMessage', {
  ok : true,
  channel : info.channel,
  message : {
    attachments : [{ text : info.text }]
  }
});

(async() => { // enable botkit-mock storage
  await util.promisify(controller.storage.channels.save) ({ id: 'foo' });
})();

bot.replyPrivate = function(src, resp, cb) {
  let msg = {};
  if (typeof(resp) == 'string') {
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
    uri: src.response_url,
    method: 'POST',
    json: msg
  };
  bot.api.callAPI('replyPrivate', requestOptions, (err, resp, body) => {
    if (err) {
      botkit.log.error('Error sending interactive message response:', err);
      cb && cb(err);
    } else {
      cb && cb();
    }
  });
};

describe('slack-kidoku', function() {
  before(() => {
    events(controller, bot);
  });
  after(() => {
    controller.shutdown();
  });
  describe('/kidoku command', () => {
    before(() => {
      this.sequence = [{
          type : 'slash_command',
          user : info.user_id,
          channel : info.channel,
          messages : [{
            isAssertion : true,
            token : '',
            channel_id : info.channel,
            user_id : info.user_id,
            command : '/kidoku',
            text : 'kidoku',
            response_url : 'https://hooks.slack.com/commands/foo/bar'
          }]
      }];
    });
    it('return confirm message', () => {
      return bot.usersInput(this.sequence).then(() => {
        const reply = bot.api.logByKey['replyPrivate'].slice(-1)[0].json;
        assert(reply.attachments[0].callback_id === 'preview');
        assert(reply.attachments[1].callback_id === 'slack-kidoku-confirm');
      })
    });
    it('return error text when text was empty', () => {
      const seq = JSON.parse(JSON.stringify(this.sequence));
      seq[0].messages[0].text = '';
      return bot.usersInput(seq).then(() => {
        const reply = bot.api.logByKey['replyPrivate'].slice(-1)[0].json;
        assert(reply.text);
        assert(!reply.attachments);
      })
    });
    it('return error text when command used in direct messages', () => {
      const seq = JSON.parse(JSON.stringify(this.sequence));
      seq[0].channel = info.im;
      seq[0].messages[0].channel_id = info.im;
      return bot.usersInput(seq).then(() => {
        const reply = bot.api.logByKey['replyPrivate'].slice(-1)[0].json;
        assert(reply.text);
        assert(!reply.attachments);
      })
    });
  });
  describe('confirm message buttons', () => {
    before(() => {
      this.sequence = [{
          type : 'interactive_message_callback',
          user : info.user_id,
          channel : info.channel,
          messages : [{
            isAssertion : true,
            token : '',
            channel : info.channel,
            user_id : info.user_id,
            text : info.text,
            callback_id : 'slack-kidoku-confirm',
            actions : [{ name: 'ok', type: 'button', value: info.text }],
            response_url : 'https://hooks.slack.com/commands/foo/bar'
          }]
      }];
    });
    it('post kidoku button message to channel if ok button is pushed', () => {
      return bot.usersInput(this.sequence).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === 'Success!');
        const reply = bot.api.logByKey['chat.postMessage'].slice(-1)[0];
        assert(reply.attachments[0].callback_id === 'slack-kidoku');
        assert(reply.channel === info.channel);
        assert(reply.attachments[0].author_name === info.user_name);
        assert(reply.attachments[0].text === info.text);
      })
    });
    it('post kidoku button message to private group if ok button is pushed', () => {
      const seq = JSON.parse(JSON.stringify(this.sequence));
      seq[0].messages[0].channel = info.group;
      return bot.usersInput(seq).then(() => {
        const reply = bot.api.logByKey['chat.postMessage'].slice(-1)[0];
        assert(reply.channel === info.group);
      })
    });
    it('show only cancel message if cancel button is pushed', () => {
      bot.api.setData('chat.postMessage', {
        ok : true,
        channel : info.channel,
        message : {
          attachments : [{ text : info.text }]
        }
      });
      const seq = JSON.parse(JSON.stringify(this.sequence));
      seq[0].messages[0].actions[0].name = 'cancel';
      return bot.usersInput(seq).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === 'Canceled :wink:');
      })
    });
    it('show error message if there is error', () => {
      bot.api.setData('chat.postMessage', {
        ok : false,
        error : 'request_timeout'
      });
      return bot.usersInput(this.sequence).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === 'Sorry, something went wrong.')
      })
    });
    it('show special error message if there is channel_not_found error', () => {
      bot.api.setData('chat.postMessage', {
        ok : false,
        error : 'channel_not_found'
      });
      return bot.usersInput(this.sequence).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === 'Bot should be part of this channel or DM :persevere: \nPlease `/invite @kidoku` to use `/kidoku` command here.')
      })
    });
  });
  describe('kidoku buttons', () => {
    let originalMessage;
    before(async() => {
      const data = await util.promisify(controller.storage.channels.get)(info.channel);
      originalMessage = bot.api.logByKey['chat.postMessage'][0];
      const value = originalMessage.attachments[0].actions[0].value;
      this.sequence = [{
          type : 'interactive_message_callback',
          user : info.user_id,
          channel : info.channel,
          messages : [{
            isAssertion : true,
            token : '',
            channel : info.channel,
            user : info.user_id,
            text : value,
            callback_id : 'slack-kidoku',
            actions : [{ name: 'kidoku', type: 'button', value: value }],
            original_message : originalMessage,
            response_url : 'https://hooks.slack.com/commands/foo/bar'
          }]
      }];
    });
    it('add name of who pushed kidoku button to original message', () => {
      return bot.usersInput(this.sequence).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(JSON.stringify(replyInteractive.attachments[0]) === JSON.stringify(originalMessage.attachments[0]), 'buttons should remain same as previous');
        assert(replyInteractive.attachments[1].text === `<@${info.user_id}>`);
      })
    });
    it('concatenate username by comma if several users pushed button', () => {
      const seq = JSON.parse(JSON.stringify(this.sequence));
      seq[0].messages[0].user = 'U98765432';
      return bot.usersInput(seq).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(JSON.stringify(replyInteractive.attachments[0]) === JSON.stringify(originalMessage.attachments[0]), 'buttons should remain same as previous');
        assert(replyInteractive.attachments[1].text === `<@${info.user_id}>, <@U98765432>`);
      })
    });
    it('delete username if it already exist in members who have pushed button', () => {
      return bot.usersInput(this.sequence).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(JSON.stringify(replyInteractive.attachments[0]) === JSON.stringify(originalMessage.attachments[0]), 'buttons should remain same as previous');
        assert(replyInteractive.attachments[1].text === `<@U98765432>`);
      })
    });
  });
});
