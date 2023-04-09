import {Config} from "./config.js";
import {Message} from "wechaty";
import {ContactInterface, RoomInterface} from "wechaty/impls";
import {Configuration, OpenAIApi} from "openai";
// @ts-ignore
import fetch from "node-fetch";

enum MessageType {
    Unknown = 0,
    Attachment = 1, // Attach(6),
    Audio = 2, // Audio(1), Voice(34)
    Contact = 3, // ShareCard(42)
    ChatHistory = 4, // ChatHistory(19)
    Emoticon = 5, // Sticker: Emoticon(15), Emoticon(47)
    Image = 6, // Img(2), Image(3)
    Text = 7, // Text(1)
    Location = 8, // Location(48)
    MiniProgram = 9, // MiniProgram(33)
    GroupNote = 10, // GroupNote(53)
    Transfer = 11, // Transfers(2000)
    RedEnvelope = 12, // RedEnvelopes(2001)
    Recalled = 13, // Recalled(10002)
    Url = 14, // Url(5)
    Video = 15, // Video(4), Video(43)
    Post = 16, // Moment, Channel, Tweet, etc
}

export class ChatGPTBot {
    //启动时间
    startTime: Date = new Date();

    // chatbot name (WeChat account name)
    botName: string = "";

    // self-chat may cause some issue for some WeChat Account
    // please set to true if self-chat cause some errors
    disableSelfChat: boolean = false;

    // chatbot trigger keyword
    chatgptTriggerKeyword: string = Config.chatgptTriggerKeyword;

    // ChatGPT error response
    chatgptErrorMessage: string = "🤖️：ChatGPT摆烂了，请稍后再试～";

    // ChatGPT model configuration
    // please refer to the OpenAI API doc: https://beta.openai.com/docs/api-reference/introduction
    chatgptModelConfig: object = {
        // this model field is required
        model: "gpt-3.5-turbo",
        // add your ChatGPT model parameters below
        temperature: 0.8,
        // max_tokens: 2000,
    };

    // ChatGPT system content configuration (guided by OpenAI official document)
    currentDate: string = new Date().toISOString().split("T")[0];
    chatgptSystemContent: string = `You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible.\nKnowledge cutoff: 2021-09-01\nCurrent date: ${this.currentDate}`;

    // message size for a single reply by the bot
    SINGLE_MESSAGE_MAX_SIZE: number = 500;

    // OpenAI API
    private openaiAccountConfig: any; // OpenAI API key (required) and organization key (optional)
    private openaiApiInstance: any; // OpenAI API instance

    //抽签相关
    signData: Array<any> = new Array<any>();
    signMap: Map<string, Date> = new Map;
    signContentMap: Map<string, string> = new Map;

    //每日一句
    yijuMap: Map<string, Date> = new Map;
    yijuContentMap: Map<string, string> = new Map;

    // set bot name during login stage
    setBotName(botName: string) {
        this.botName = botName;
    }

    // get trigger keyword in group chat: (@Name <keyword>)
    // in group chat, replace the special character after "@username" to space
    // to prevent cross-platfrom mention issue
    private get chatGroupTriggerKeyword(): string {
        return `@${this.botName} ${this.chatgptTriggerKeyword || ""}`;
    }

    // configure API with model API keys and run an initial test
    async startGPTBot() {
        try {
            // OpenAI account configuration
            this.openaiAccountConfig = new Configuration({
                organization: Config.openaiOrganizationID,
                apiKey: Config.openaiApiKey,
            });
            // OpenAI API instance
            this.openaiApiInstance = new OpenAIApi(this.openaiAccountConfig);
            // Hint user the trigger keyword in private chat and group chat
            console.log(`🤖️ ChatGPT name is: ${this.botName}`);
            console.log(
                `🎯 Trigger keyword in private chat is: ${this.chatgptTriggerKeyword}`
            );
            console.log(
                `🎯 Trigger keyword in group chat is: ${this.chatGroupTriggerKeyword}`
            );
            // Run an initial test to confirm API works fine
            await this.onChatGPT("Say Hello World");
            console.log(`✅ ChatGPT starts success, ready to handle message!`);
        } catch (e) {
            console.error(`❌ ${e}`);
        }
    }

    // get clean message by removing reply separater and group mention characters
    private cleanMessage(
        rawText: string,
        isPrivateChat: boolean = false
    ): string {
        let text = rawText;
        const item = rawText.split("- - - - - - - - - - - - - - -");
        if (item.length > 1) {
            text = item[item.length - 1];
        }
        return text.substring(
            isPrivateChat
                ? this.chatgptTriggerKeyword.length + 1
                : text.indexOf(this.chatgptTriggerKeyword) + this.chatgptTriggerKeyword.length + 1
        );
    }

    // check whether ChatGPT bot can be triggered
    private triggerGPTMessage(
        text: string,
        isPrivateChat: boolean = false
    ): boolean {
        const chatgptTriggerKeyword = this.chatgptTriggerKeyword;
        let triggered = false;
        if (isPrivateChat) {
            triggered = chatgptTriggerKeyword
                ? text.startsWith(chatgptTriggerKeyword)
                : true;
        } else {
            // due to un-unified @ lagging character, ignore it and just match:
            //    1. the "@username" (mention)
            //    2. trigger keyword
            // start with @username
            // const textMention = `@${this.botName}`;
            // const startsWithMention = text.startsWith(textMention);
            // const textWithoutMention = text.slice(textMention.length + 1);
            // const followByTriggerKeyword = textWithoutMention.startsWith(
            //     this.chatgptTriggerKeyword
            // );
            // triggered = startsWithMention && followByTriggerKeyword;
            const keywords = ["@220", "@平安喜乐", "@赛博算命"];
            for (let i = 0; i < keywords.length; i++) {
                let keyword = keywords[i].replace(/\s/g, '') + this.chatgptTriggerKeyword;
                if (text.replace(/\s/g, '').startsWith(keyword)) {
                    triggered = true;
                    break;
                }
            }
        }
        if (triggered) {
            console.log(`🎯 ChatGPT triggered: ${text}`);
        }
        return triggered;
    }

    // filter out the message that does not need to be processed
    private isNonsense(
        talker: ContactInterface,
        messageType: MessageType,
        text: string
    ): boolean {
        return (
            (this.disableSelfChat && talker.self()) ||
            messageType != MessageType.Text ||
            talker.name() == "微信团队" ||
            // video or voice reminder
            text.includes("收到一条视频/语音聊天消息，请在手机上查看") ||
            // red pocket reminder
            text.includes("收到红包，请在手机上查看") ||
            // location information
            text.includes("/cgi-bin/mmwebwx-bin/webwxgetpubliclinkimg")
        );
    }

    // create messages for ChatGPT API request
    // TODO: store history chats for supporting context chat
    private createMessages(text: string): Array<Object> {
        const messages = [
            {
                role: "system",
                content: this.chatgptSystemContent,
            },
            {
                role: "user",
                content: text,
            },
        ];
        return messages;
    }

    // send question to ChatGPT with OpenAI API and get answer
    private async onChatGPT(text: string): Promise<string> {
        const inputMessages = this.createMessages(text);
        try {
            // config OpenAI API request body
            const response = await this.openaiApiInstance.createChatCompletion({
                ...this.chatgptModelConfig,
                messages: inputMessages,
            });
            // use OpenAI API to get ChatGPT reply message
            const chatgptReplyMessage =
                response?.data?.choices[0]?.message?.content?.trim();
            console.log(`🤖️ ChatGPT says: ${chatgptReplyMessage}`);
            return chatgptReplyMessage;
        } catch (e: any) {
            console.error(`❌ ${e}`);
            const errorResponse = e?.response;
            const errorCode = errorResponse?.status;
            const errorStatus = errorResponse?.statusText;
            const errorMessage = errorResponse?.data?.error?.message;
            if (errorCode && errorStatus) {
                const errorLog = `Code ${errorCode}: ${errorStatus}`;
                console.error(`❌ ${errorLog}`);
            }
            if (errorMessage) {
                console.error(`❌ ${errorMessage}`);
            }
            return this.chatgptErrorMessage;
        }
    }

    // reply with the segmented messages from a single-long message
    private async reply(
        talker: RoomInterface | ContactInterface,
        mesasge: string
    ): Promise<void> {
        const messages: Array<string> = [];
        let message = mesasge;
        while (message.length > this.SINGLE_MESSAGE_MAX_SIZE) {
            messages.push(message.slice(0, this.SINGLE_MESSAGE_MAX_SIZE));
            message = message.slice(this.SINGLE_MESSAGE_MAX_SIZE);
        }
        messages.push(message);
        for (const msg of messages) {
            await talker.say(msg);
        }
    }

    // reply to private message
    private async onPrivateMessage(talker: ContactInterface, text: string, message: Message) {
        // get reply from ChatGPT
        const chatgptReplyMessage = await this.onChatGPT(text);
        // send the ChatGPT reply to chat
        const wholeReplyMessage = `${text}\n----------\n${chatgptReplyMessage}`;
        await this.reply(talker, wholeReplyMessage);
    }

    // reply to group message
    private async onGroupMessage(room: RoomInterface, text: string, message: Message) {
        // get reply from ChatGPT
        const chatgptReplyMessage = await this.onChatGPT(text);
        // the whole reply consist of: original text and bot reply
        const wholeReplyMessage = `@${message.talker().name()}\n${text}\n----------\n${chatgptReplyMessage}`;
        await this.reply(room, wholeReplyMessage);
    }

    // receive a message (main entry)
    async onMessage(message: Message) {
        const talker = message.talker();
        const rawText = message.text();
        const room = message.room();
        const messageType = message.type();
        const isPrivateChat = !room;
        // do nothing if the message:
        //    1. is irrelevant (e.g. voice, video, location...), or
        //    2. doesn't trigger bot (e.g. wrong trigger-word)
        if (
            this.isNonsense(talker, messageType, rawText) ||
            !this.triggerGPTMessage(rawText, isPrivateChat)
        ) {
            return;
        }
        // clean the message for ChatGPT input
        const text = this.cleanMessage(rawText, isPrivateChat);
        // reply to private or group chat
        if (isPrivateChat) {
            return await this.onPrivateMessage(talker, text, message);
        } else {
            // @ts-ignore
            return await this.onGroupMessage(room, text, message);
        }
    }

    async fetchAPI(url: string) {
        try {
            const response = await fetch(url)
            console.log({response});
            if (response.status === 200) {
                return await response.json();
            } else {
                console.log('请求异常')
            }
        } catch (err) {
            console.log(err)
        }
        return null;
    }

    async fetchHtml(url: string) {
        try {
            const response = await fetch(url)
            console.log({response});
            if (response.status === 200) {
                return await response.text();
            } else {
                console.log('请求异常')
            }
        } catch (err) {
            console.log(err)
        }
        return null;
    }

    async getNow() {
        let res = await this.fetchHtml('https://quan.suning.com/getSysTime.do');
        console.log({getNow: res});
        if (res && JSON.parse(res)?.sysTime2) {
            return JSON.parse(res)?.sysTime2.substring(0, 10);
        }
        return null;
    }

    // handle message for customized task handlers
    async onCustimzedTask(message: Message) {
        this.麦扣(message);
        this.抽签(message);
        this.解签(message);
        this.每日一句(message);
    }

    async 麦扣(message: Message) {
        // e.g. if a message starts with "麦扣", the bot sends "🤖️：call我做咩啊大佬!"
        const myKeyword = "麦扣";
        if (message.text().includes(myKeyword)) {
            const myTaskContent = `回复所有含有"${myKeyword}"的消息`;
            const myReply = "🤖️：call我做咩啊大佬";
            await message.say(myReply);
            console.log(`🎯 Customized task triggered: ${myTaskContent}`);
            console.log(`🤖️ ChatGPT says: ${myReply}`);
            return;
        }
    }

    async 抽签(message: Message) {
        const keywords = ["@220 抽签", "@平安喜乐 抽签", "@赛博算命 抽签"];
        for (let i = 0; i < keywords.length; i++) {
            let keyword = keywords[i].replace(/\s/g, '');
            if (message.text().replace(/\s/g, '').startsWith(keyword)) {
                console.log(`🎯 Customized task triggered: ${keyword}`);
                let talkerId = message.talker().id;
                let date = this.signMap.get(talkerId);
                let now = await this.getNow();
                console.log({now: now, signMap: this.signMap, talkerId: talkerId})
                if (date && date === now) {
                    const reply = `@${message.talker().name()} 你今天已经抽过签了`;
                    await message.say(reply);
                    break;
                }
                this.signMap.set(talkerId, now);
                if (!this.signData || this.signData.length <= 0) {
                    let res = await this.fetchHtml('https://docs.hdfk7.cn/static/000f.json');
                    console.log({res: res});
                    if (res) {
                        this.signData = JSON.parse(res);
                    }
                }
                let index = parseInt(Math.random() * this.signData.length + "", 10);
                let element = this.signData[index];
                let content = `\r\n${element?.name}\r\n${element?.value}`;
                this.signContentMap.set(talkerId, index + "");
                const reply = `@${message.talker().name()} ${content}`;
                await message.say(reply);
                break;
            }
        }
    }

    async 解签(message: Message) {
        const keywords = ["@220 解签", "@平安喜乐 解签", "@赛博算命 解签"];
        for (let i = 0; i < keywords.length; i++) {
            let keyword = keywords[i].replace(/\s/g, '');
            if (message.text().replace(/\s/g, '').startsWith(keyword)) {
                console.log(`🎯 Customized task triggered: ${keyword}`);
                let talkerId = message.talker().id;
                let date = this.signMap.get(talkerId);
                let now = await this.getNow();
                if (!date || date !== now) {
                    const reply = `@${message.talker().name()} 你今天还没有抽签呢`;
                    await message.say(reply);
                    break;
                }
                let index = this.signContentMap.get(talkerId);
                // @ts-ignore
                let element = this.signData[parseInt(index, 10)];
                let content = `\r\n${element?.name}\r\n${element?.value}\r\n----------\r\n${element.explain}`;
                const reply = `@${message.talker().name()} ${content}`;
                await message.say(reply);
                break;
            }
        }
    }

    async 每日一句(message: Message) {
        const keywords = ["@220 fw", "@平安喜乐 fw ", "@赛博算命 fw"];
        for (let i = 0; i < keywords.length; i++) {
            let keyword = keywords[i].replace(/\s/g, '');
            if (message.text().replace(/\s/g, '').startsWith(keyword)) {
                console.log(`🎯 Customized task triggered: ${keyword}`);
                let talkerId = message.talker().id;
                let date = this.yijuMap.get(talkerId);
                let now = await this.getNow();
                if (date && date === now) {
                    let content = this.yijuContentMap.get(talkerId);
                    const reply = `@${message.talker().name()} ${content}`;
                    await message.say(reply);
                    break;
                }
                this.yijuMap.set(talkerId, now);
                let res = await this.fetchAPI('https://www.mxnzp.com/api/daily_word/recommend?count=10&app_id=ckklxdsimobnsug8&app_secret=SUJUU1pKTnJhSjBhcHdVK09ocXFkUT09');
                if (res && res.code === 1 && res.data) {
                    res = res.data[parseInt(Math.random() * res.data.length + "", 10)];
                }
                let content = res ? res.content : "api调用失败";
                this.yijuContentMap.set(talkerId, content);
                const reply = `@${message.talker().name()} ${content}`;
                await message.say(reply);
                break;
            }
        }
    }
}
