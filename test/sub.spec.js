const EventEmitter = require('events').EventEmitter;

const PubSub = require('../index.js');

const emitter = new EventEmitter();
emitter.on('error', console.error.bind(console));
emitter.on('log', console.log.bind(console));
emitter.on('success', console.log.bind(console));

const pubsub = new PubSub('pubsub', emitter, {
  projectId: 'quizizz-dev',
});

function sub() {
  return pubsub.init()
    .then(() => {
      return pubsub.createTopic('test');
    })
    .then(() => {
      return pubsub.subscribe('test', 'test_subs', (msg) => {
        console.log(msg.data);
        setTimeout(() => {
          msg.ack();
        }, 3000);
      }, {
        maxInProgress: 3,
        ackDeadlineSeconds: 20,
      });
    });
}

sub().then(() => console.log('Subsciption')).catch(console.error.bind(console));

