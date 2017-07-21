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

const controller = botkitMock({ /*debug : false*/ });
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
bot.api.setData('chat.postMessage', {
  ok : true,
  channel : info.channel,
  message : {
    attachments : [{ text : ''  }]
  }
});

(async() => { // enable botkit-mock storage
  await util.promisify(controller.storage.channels.save) ({ id: info.channel });
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
  this.timeout(10000);
  before(() => {
    events(controller, bot);
  });
  after(() => {
    controller.shutdown();
  });
  /*
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
      const seq = this.sequence;
      seq[0].messages[0].text = '';
      return bot.usersInput(seq).then(() => {
        const reply = bot.api.logByKey['replyPrivate'].slice(-1)[0].json;
        assert(reply.text);
        assert(!reply.attachments);
      })
    });
    it('return error text when command used in direct messages', () => {
      const seq = this.sequence;
      seq[0].channel = info.im;
      seq[0].messages[0].channel_id = info.im;
      return bot.usersInput(seq).then(() => {
        const reply = bot.api.logByKey['replyPrivate'].slice(-1)[0].json;
        assert(reply.text);
        assert(!reply.attachments);
      })
    });
  });*/
  describe('confirm message buttons', () => {
    before(() => {
      this.sequence = [{
          type : 'interactive_message_callback',
          user : info.user_id,
          channel : info.channel,
          messages : [{
            isAssertion : true,
            token : '',
            channel_id : info.channel,
            user_id : info.user_id,
            text : info.text,
            callback_id : 'slack-kidoku-confirm',
            actions : [{ name: 'ok', type: 'button', value: info.text }],
            response_url : 'https://hooks.slack.com/commands/foo/bar'
          }]
      }];
    });
    it('return confirm message', () => {
      return bot.usersInput(this.sequence).then(() => {
        const replyInteractive = bot.api.logByKey['replyInteractive'].slice(-1)[0].json;
        assert(replyInteractive.text === 'Success!');
        const reply = bot.api.logByKey['chat.postMessage'].slice(-1)[0].json;
        console.log(bot.api.logByKey['chat.postMessage'].slice(-1)[0]); // TODO
      })
    });
  });
});
