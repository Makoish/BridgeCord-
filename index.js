const { Client, Location, Poll, List, Buttons, LocalAuth, MessageMedia  } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sequelize = require("./config/database");
const GroupBind = require("./models/groupBind");
const createDirectories = require("./createDirectories");

createDirectories();
require('dotenv').config()
const app = express();
const port = 3000;

app.use(bodyParser.json());



sequelize.sync({}) // Set to `true` only for dev mode (drops and recreates table)
    .then(() => console.log("Database & tables created!"))
    .catch(err => console.error("DB sync error:", err));



async function sendMessage(json) {
    try {
        FLASK_URL = process.env.FLASK_URL
        const response = await axios.post(`${FLASK_URL}/send-message`, json, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        return { data: response.data, status: response.status };
    } catch (error) {
        console.error('Error:', error.message);
    }
}






const client = new Client({
    authStrategy: new LocalAuth(),
    // proxyAuthentication: { username: 'username', password: 'password' },
    puppeteer: { 
        // args: ['--proxy-server=proxy-server-that-requires-authentication.example.com'],
        headless: true,
        executablePath: "/usr/bin/chromium-browser",
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});



client.on('qr', async (qr) => {
    // Generates a QR to be scanned through WhatsApp
    qrcode.generate(qr, { small: true });
});



client.on('group_join', async (notification) => {
    try {
        const botNumber = client.info.wid._serialized;
            if (notification.recipientIds.includes(botNumber)) {
            const chat = await client.getChatById(notification.chatId);
            await chat.sendMessage(`Group ID: ${chat.id._serialized}`);
            GroupBind.create({ whts_id: chat.id._serialized, ds_id: null });
        }
    } catch (error) { 
        console.error('Error sending group ID:', error);
    }
});


// client.on('group_leave', async (notification) => {
//     const botNumber = client.info.wid._serialized;

//     if (notification.recipientIds.includes(botNumber)) {
//         const chat = await client.getChatById(notification.chatId);
        
//         FLASK_URL = process.env.FLASK_URL
//         json = {
//             whts_id: chat.id._serialized 
//         }
//         const response = await axios.post(`${FLASK_URL}/leave`, json, {
//             headers: {
//                 'Content-Type': 'application/json'
//             }
//         });

//         await GroupBind.destroy({
//             where: { whts_id: chat.id._serialized }
//         });
       
//     }
// });





// client.on('message', async msg => {
//     //!verify <discord-name>
    
//     body = msg.body
//     if (body.length == 0 || body.charAt(0) != '!')
//         return;

//     let author_number = msg._data.from
//     if (author_number != undefined)
//         author_number = author_number.replace(/[:@].*/, "");
    
//     const command = body.replace(/^!/, '').split(/\s+/).map(s => s.trim()).filter(s => s !== "");
//     if (command.length == 1){ // send the correct commands
//         return;
//     }


//     console.log(command)
    

// });


client.on('message_create', async (msg) => {

    const chat = await msg.getChat();
    if (msg.fromMe)
        return;

    // let author_number = msg._data.author
    const author_name = msg._data.notifyName


    let data = {}
    data.id = chat.id._serialized

    const chat_record = await GroupBind.findOne({ where: { whts_id:  chat.id._serialized } });
    console.log(chat_record)
    if (chat_record == null || ( chat_record && chat_record.ds_id === null)) 
        return;

    
    


    data.body = msg.body
    if (author_name != undefined)
        data.author = author_name

    
    if (msg.hasMedia) {
        console.log(msg.type)
        if (msg.type  === 'ptt' || msg.type === 'audio'){
            const media = await msg.downloadMedia();
            const uuid = uuidv4();
            const filePath = path.join('voice_notes', `${uuid}.ogg`);
            fs.writeFileSync(filePath, media.data, 'base64');
            data.media = {}
            data.media.type = "voice"
            data.media.path = filePath
        }
        if (msg.type === 'image'){
            const media = await msg.downloadMedia();
            const uuid = uuidv4();
            const filePath = path.join('images', `${uuid}.jpg`);
            fs.writeFileSync(filePath, media.data, 'base64');
            data.media = {}
            data.media.type = "img"
            data.media.path = filePath
        }

        if (msg.type === 'document'){
            return;// for now
            const media = await msg.downloadMedia();
            const uuid = uuidv4();
            const mimeType = media.mimetype; // e.g., "application/pdf"
            const extension = mimeType.split('/')[1]; // Extracts "pdf"'
            const filePath = path.join('files', `${uuid}.${extension}`);
            fs.writeFileSync(filePath, media.data, 'base64');
            data.media = {}
            data.media.type = "doc"
            data.media.path = filePath

        }
    }

    const respone = sendMessage(data)
    
    
    
});


app.post('/send-message', async (req, res) => {
    const body  = req.body.body
    const attachments = req.body.attachments
    const author = req.body.author
    const guild_id = req.body.id
    const chat_record = await GroupBind.findOne({ where: { ds_id:  guild_id } });

    if (chat_record == null)
        return res.json({ message: 'Group is not bound' });
    

    group_id = chat_record.dataValues.whts_id // check if char_record 
    if (attachments.length == 0){
        await client.sendMessage(group_id, `${author}: ` + body);
        return res.json({ success: true, message: 'Message sent successfully!' });
    }
    
    
    try{
        for (const _att of attachments){
            
            if (_att.type == 'audio'){
                const media = await MessageMedia.fromFilePath(_att.path);
                await client.sendMessage(group_id, media, { sendAudioAsVoice: true });
                await client.sendMessage(group_id, `Voice note by: ${author}: `);
                fs.unlink(_att.path, () => {});
            }   
            else{
                const media = await MessageMedia.fromUrl(_att.url);
                if (body.length > 0){
                    await client.sendMessage(group_id, media, {caption: `${author}: ` + body});
                }
                else{
                    await client.sendMessage(group_id, media, {caption: `Sent by ${author}`});
                }
            }
        }
        return res.json({ success: true, message: 'Message sent successfully!' });
    } catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).json({ error: 'Failed to send message.' });
    }


});


app.post('/get-code', async (req, res) => {
    guild_id = String(req.body.guild_id)
    console.log(guild_id)
    const chat_record = await GroupBind.findOne({ where: { ds_id:  guild_id } });
    if (chat_record == null)
        return res.json({ message: "discord group is not bound" }); 
    let chat = await client.getChatById(chat_record.whts_id);
    const invite_code = await chat.getInviteCode();
    const invite_url = `https://chat.whatsapp.com/${invite_code}`
    
    return res.status(200).json({ "invite_url": invite_url });
    

});


app.post('/leave', async (req, res) => {

    
    whts_id = req.body.whts_id
    let chat = await client.getChatById(whts_id);
    if (chat.isGroup) 
        await chat.leave();
    
    await GroupBind.destroy({
        where: { whts_id: whts_id }
    });
    return res.json({ "message": "bot has left"});
        
      


});




client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
});


client.on('authenticated', () => {
    console.log('AUTHENTICATED');
});

client.on('auth_failure', msg => {
    // Fired if session restore was unsuccessful
    console.error('AUTHENTICATION FAILURE', msg);
});



client.initialize();

app.listen(port, () => {
    console.log(`Server is running on 52.70.209.199:${port}`);
});