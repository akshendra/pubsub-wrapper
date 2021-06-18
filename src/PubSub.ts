import { PubSub as PubSubCore, SubscriptionOptions, Topic } from '@google-cloud/pubsub';
import safeJSON from 'safely-parse-json';
import EventEmitter from 'events';

interface PubSubConfig {
  projectId: string;
  file: string;
  credentials: {
    client_email: string;
    private_key: string;
  };
  ack_deadline_seconds?: number;
}

/**
 * @class PubSub
 */
class PubSub {
  /**
   * @param {string} name - unique name to this service
   * @param {EventEmitter} emitter
   * @param {Object} config - configuration object of service
   */
  name: string;
  emitter: EventEmitter;
  config: PubSubConfig;
  client: PubSubCore;
  topics: { [_: string]: Topic };

  constructor(name: string, emitter: EventEmitter, config: PubSubConfig) {
    this.name = name;
    this.emitter = emitter;
    this.config = { ack_deadline_seconds: 300, ...config };
    this.client = null;
    this.topics = {};
  }

  log(message: string, data?: Record<string, unknown>) {
    this.emitter.emit('log', {
      service: this.name,
      message,
      data,
    });
  }

  success(message: string, data?: Record<string, unknown>) {
    this.emitter.emit('success', {
      service: this.name,
      message,
      data,
    });
  }

  error(err: Error, data?: Record<string, unknown>) {
    this.emitter.emit('error', {
      service: this.name,
      data,
      err,
    });
  }

  /**
   * Initialize the config for connecting to google apis
   *
   * @return {Promise<this>}
   */
  async init(): Promise<PubSub> {
    this.log('Using config', {
      projectId: this.config.projectId,
      email: this.config.credentials
        ? this.config.credentials.client_email
        : 'n/a',
      method: this.config.credentials ? 'PrivateKey' : 'KeyFile',
    });
    const client = new PubSubCore({
      projectId: this.config.projectId,
      keyFile: this.config.file,
      credentials: this.config.credentials,
    });
    return client.getTopics().then(() => {
      this.client = client;
      this.success(
        `Successfully connected on project ${this.config.projectId}`,
      );
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
  async createTopic(name: string): Promise<boolean> {
    const topic = this.client.topic(name);
    this.log(`Creating topic ${name}`);
    const [exists] = await topic.exists();
    if (exists === true) {
      this.success(`Topic "${name}" already exists`);
      this.topics[name] = topic;
      return true;
    }
    // Create the topic
    const [createdTopic] = await topic.create();
    this.topics[name] = createdTopic;
    const message = `Topic "${name}" created`;
    this.success(message);
    return true;
  }

  /**
   * Delete a topic, won't delete the subscription though
   *
   * @param {string} name - topic to delete
   *
   * @return {Promise<boolean>} resolve(true)
   */
  async deleteTopic(name: string): Promise<boolean> {
    const topic = this.topics[name];
    await topic.delete();
    const message = `Deleted topic ${topic.name}`;
    this.log(message);
    delete this.topics[name];
    return true;
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
  async subscribe(
    topicName: string,
    subName: string,
    cb: (...args: any) => any,
    options: { maxInProgress?: number, ackDeadlineSeconds?: number } = {},
  ): Promise<boolean> {
    const { maxInProgress = 1, ackDeadlineSeconds = this.config.ack_deadline_seconds } = options;
    const opts: SubscriptionOptions = {
      flowControl: {
        maxMessages: maxInProgress,
      },
      ackDeadline: ackDeadlineSeconds,
    };

    const topic = this.topics[topicName];
    let subscription = topic.subscription(subName, opts);

    this.log('Subscribing', {
      topicName,
      subName,
      opts: { maxInProgress, ackDeadlineSeconds },
    });

    // Check if the subscription exists
    return subscription
      .exists()
      .then((result) => {
        const exists = result[0];
        if (exists === true) {
          this.success('Subscription already exists', {
            topicName: topic.name,
            subName: subscription.name,
          });
          return subscription;
        }

        return subscription.create().then((res) => {
          this.success('Created subscription', {
            topicName: topic.name,
            subName: subscription.name,
          });
          subscription = res[0]; // eslint-disable-line
          return subscription;
        });
      })
      .then((sub) => {
        sub.on('message', (msg) => {
          const newmsg = {
            nack: msg.nack ? msg.nack.bind(msg) : () => {},
            skip: msg.skip ? msg.skip.bind(msg) : () => {},
            ack: msg.ack.bind(msg),
            data: safeJSON(msg.data.toString()),
          };
          return cb(newmsg);
        });
        sub.on('error', (err) => {
          this.error(err, {
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
  async unsubscribe(
    topicName: string,
    subName: string,
    cb: (...args: any) => any,
  ): Promise<boolean> {
    const topic = this.topics[topicName];
    const subscription = topic.subscription(subName);
    // Remove the listener from subscription
    subscription.removeListener('message', cb);
    return subscription.delete().then(() => {
      const message = `Removed listener from ${topic.name}, ${subscription.name}`;
      this.log(message, {
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
  async publish(
    topicName: string,
    content?: Record<string, unknown>,
    meta: { replyTo?: string; correlationId?: string } = {},
    handle: boolean = true,
  ): Promise<void> {
    const topic = this.topics[topicName];
    const publishPromise = topic.publisher.publish(
      Buffer.from(
        JSON.stringify({
          content,
          meta,
        }),
      ),
    );

    if (handle === false) {
      return;
    }

    await publishPromise.catch((err) => {
        this.error(err, {
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
  async send(
    topicName: string,
    content: Record<string, unknown>,
    meta: Record<string, unknown>,
    handler: boolean = true,
  ): Promise<void> {
    const topic = this.client.topic(topicName);
    const publishPromise = topic.publish(
      Buffer.from(
        JSON.stringify({
          content,
          meta,
        }),
      ),
    );

    if (handler === false) {
      return;
    }

    await publishPromise.catch((err) => {
        this.error(err, {
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
   * @param {Buffer} data - the data to be sent
   * @param {boolean} [handle=true] - whether to handle the error here
   *
   * @return {Promise}
   */
  async sendWithoutCover(
    topicName: string,
    data: Buffer,
    handler = true,
  ): Promise<void> {
    const topic = this.client.topic(topicName);
    const publishPromise = topic.publish(data);
    if (handler === false) {
      return;
    }

    await publishPromise.catch((err) => {
        this.error(err, {
          topicName,
          message: data,
        });
      });
  }
}

module.exports = PubSub;
