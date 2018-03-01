/**
 * Google PubSub Service
 *
 * @Author: Akshendra Pratap Singh
 * @Date: 2017-07-10 13:13:33
 * @Last Modified by: Akshendra Pratap Singh
 * @Last Modified time: 2017-08-31 16:34:37
 */

const ps = require('@google-cloud/pubsub');

const Service = require('service-base');
const { validate, joi } = require('validator');
const misc = require('misc');


/**
 * @class PubSub
 */
class PubSub extends Service {
  /**
   * @param {string} name - unique name to this service
   * @param {EventEmitter} emitter
   * @param {Object} config - configuration object of service
   */
  constructor(name, emitter, config) {
    super(name, emitter, config);

    this.config = validate(config, joi.object().keys({
      projectId: joi.string().required(),
      keyFilename: joi.string(),
      ack_deadline_seconds: 300,
    }));
    this.client = null;
    this.topics = {};
  }

  /**
   * Initialize the config for connecting to google apis
   *
   * @return {Promise<this>}
   */
  init() {
    this.log.info('Using config', this.config);
    this.emitInfo('connecting', 'On google cloud', {
      projectId: this.config.projectId,
    });
    const client = ps(this.config);
    return client.getTopics().then(() => {
      this.client = client;
      this.emitSuccess(`Successfully connected on project ${this.config.projectId}`);
      return this;
    });
  }

  /**
   * Create a topic, must be done before anything else
   *
   * @param string name - name of the topic ot use
   *
   * @return {Promise<boolean>}
   */
  createTopic(name) {
    const topic = this.client.topic(name);
    this.log.info('Creating topic', {
      topic: name,
    });
    return topic.exists().then(result => {
      const exists = result[0];
      if (exists === true) {
        const message = 'Already exists';
        this.log.info(message);
        this.emitSuccess(`Topic "${name}" already exists`);
        this.topics[name] = topic;
        return true;
      }
      // Create the topic
      return topic.create().then((res) => {
        this.topics[name] = res[0]; // eslint-disable-line
        const message = `Topic "${name}" created`;
        this.log.info(message);
        this.emitSuccess(message);
        return true;
      });
    });
  }

  /**
   * Delete a topic, won't delete the subscription though
   *
   * @param {string} name - topic to delete
   *
   * @return {Promise<boolean>} resolve(true)
   */
  deleteTopic(name) {
    const topic = this.topics[name];
    return topic.delete().then(() => {
      const message = `Deleted topic ${topic.name}`;
      this.log.info(message);
      this.emitInfo('topic', message, {
        topicName: topic.name,
      });
      delete this.topics[name];
      return true;
    });
  }

  /**
   * Create a subscription and assign callback on message
   *
   * @param {string} topicName
   * @param {string} subName
   * @param {Function} cb - will get <message> with the following props
   *  id, ackId, data <pusblished>, attributes, timestamp, ack(), skip()
   * @param {Object} options - tuning params
   * @param {number} options.ackDeadlineSeconds - number of seconds
   *   after which message will marked nack
   * @param {boolean} [options.autoAck=false]
   * @param {string} [options.encoding='utf-8']
   * @param {number} [options.interval=1] - interval between taking next message
   * @param {number} [options.maxInProgress=1] - number of message at once
   * @param {string} [options.pushEndPoint]
   * @param {number} [options.timeout] - http call
   *
   * @return {Promise<true>}
   */
  subscribe(topicName, subName, cb, options = {}) {
    options = validate(options, joi.object().keys({
      ackDeadlineSeconds: joi.number().integer().min(0),
      autoAck: joi.bool().default(false),
      interval: joi.number().integer().min(0).default(1),
      maxInProgress: joi.number().integer().min(0).default(1),
      pushEndPoint: joi.string(),
      timeout: joi.number().integer().min(0),
    }));

    const opts = {
      flowControl: {
        maxMessages: options.maxInProgress,
        ackDeadlineSeconds: options.ackDeadlineSeconds || 300,
      },
      ackDeadlineSeconds: options.ackDeadlineSeconds || 300,
      maxInProgress: options.maxInProgress,
    };

    const topic = this.topics[topicName];
    let subscription = topic.subscription(subName, opts);
    let message = '';

    this.log.info('Subscribing', {
      topicName,
      subName,
      options,
    });

    // Check if the subscription exists
    return subscription.exists().then(result => {
      const exists = result[0];
      if (exists === true) {
        message = `Existing subscription on ${topic.name}, ${subscription.name}`;
        this.log.info('Subscription already exists', {
          topicName: topic.name,
          subName: subscription.name,
        });
        this.emitSuccess(`Subscription "${subName}" on "${topicName}" already exists`);
        return subscription;
      }

      return subscription.create().then(res => {
        message = `Created subscription on ${topic.name}, ${subscription.name}`;
        this.log.info('Created subscription', {
          topicName: topic.name,
          subName: subscription.name,
        });
        subscription = res[0]; // eslint-disable-line
        this.emitSuccess(`Subscription "${subName}" on topic "${topicName}" created`);
        return subscription;
      });
    }).then(sub => {
      this.log.info(message);

      sub.on('message', (msg) => {
        const newmsg = {
          nack: msg.nack ? msg.nack.bind(msg) : () => {},
          skip: msg.skip ? msg.skip.bind(msg) : () => {},
          ack: msg.ack.bind(msg),
          data: misc.safeJSON(msg.data),
        };
        return cb(newmsg);
      });
      sub.on('error', err => {
        this.emitError('subscription', err, {
          topicName: topic.name,
          subName: sub.name,
        });
      });
      return true;
    });
  }

  /**
   * Remove a subscription from a topic
   *
   * @param {string} topicName
   * @param {string} subName
   * @param {Function} cb
   *
   * @return {Promise<true>}
   */
  unsubscribe(topicName, subName, cb) {
    const topic = this.topics[topicName];
    const subscription = topic.subscription(subName);
    // Remove the listener from subscription
    subscription.removeListener('message', cb);
    return subscription.delete().then(() => {
      this.log.info(`Deleted subscription on ${topic.name}`, subscription.name);
      const message = `Removed listner from ${topic.name}, ${subscription.name}`;
      this.log.info(message);
      this.emitInfo('subscription', message, {
        topicName: topic.name,
        subName: subscription.name,
      });
      return true;
    });
  }

  /**
   * Publish a message on the given queue
   *
   * @param {string} topicName - topic should be created in this instance
   * @param {Object} content - the data to send in negotiated structure
   * @param {Object} meta - things like correlationId and replyTo
   * @param {string} meta.replyTo
   * @param {string} meta.correlationId
   * @param {boolean} [handle=true] - whether to handle the error here
   *
   * @return {Promise}
   */
  publish(topicName, content, meta = {}, handle = true) {
    meta = validate(meta, joi.object().keys({
      replyTo: joi.string(),
      correlationId: joi.string(),
    }));

    const topic = this.topics[topicName];
    const p = topic.publish(JSON.stringify({
      content,
      meta,
    }));
    if (handle === false) {
      return p;
    }

    return p.then(() => {
      this.log.info('Successfully published on', topicName);
    })
      .catch((err) => {
        this.log.error(err);
        this.emitError('publishing', err, {
          topicName,
          message: content,
          options: meta,
        });
      });
  }

  /**
   * Just send on the topic, don't worry whether it exists or not
   *
   * @param {string} topicName - name of topic
   * @param {Object} content - the data to send in negotiated structure
   * @param {Object} meta - things like correlationId and replyTo
   * @param {string} meta.replyTo
   * @param {string} meta.correlationId
   * @param {boolean} [handle=true] - whether to handle the error here
   *
   * @return {Promise}
   */
  send(topicName, content, meta, handler = true) {
    const topic = this.client.topic(topicName);
    const p = topic.publish(JSON.stringify({
      content,
      meta,
    }));

    if (handler === false) {
      return p;
    }

    return p.then(() => {
      this.log.info('Successfully published on', topicName);
    })
      .catch(err => {
        this.log.error(err);
        this.emitError('sending', err, {
          topicName,
          message: content,
          options: meta,
        });
      });
  }

  /**
   * Just send without any formating
   *
   * @param {string} topicName
   * @param {Object} data - the data to be sent
   * @param {boolean} [handle=true] - whether to handle the error here
   *
   * @return {Promise}
   */
  sendWithoutCover(topicName, data, handler = true) {
    const topic = this.client.topic(topicName);
    const p = topic.publish(data);
    if (handler === false) {
      return p;
    }

    return p.then(() => {
      this.log.info('Successfully published on', topicName);
    })
      .catch(err => {
        this.log.error(err);
        this.emitError('no cover', err, {
          topicName,
          message: data,
        });
      });
  }
}

module.exports = PubSub;
