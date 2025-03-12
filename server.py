import discord
from discord.ui import Button, View
from discord.ext import commands
from flask import Flask, request, jsonify
import asyncio
import time
import requests
import re
import os
from dotenv import load_dotenv
import uuid
import sqlite3
from sqlalchemy import create_engine, Column, String, Integer
from sqlalchemy.orm import declarative_base, sessionmaker
from discord import FFmpegPCMAudio
import qrcode
from io import BytesIO
import threading



conn = sqlite3.connect("database.sqlite")  # Ensure path matches the Express app's database
cursor = conn.cursor()

voice_clients = {}

load_dotenv()
app = Flask(__name__)
intents = discord.Intents.all()
bot = commands.Bot(command_prefix="!", intents=intents)

message_queue = asyncio.Queue()

audio_queue = asyncio.Queue()


class PlayButtonView(discord.ui.View):
    def __init__(self, data):
        super().__init__(timeout=None)  # No timeout means it stays active indefinitely
        self.data = data

    @discord.ui.button(label="Play on voice channel", style=discord.ButtonStyle.success, custom_id="play_button")
    async def play_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        voice_channel = interaction.user.voice.channel if interaction.user.voice else None
        guild_id = interaction.guild.id if interaction.guild else None  # Get guild ID
        self.data["voice_channel"] = voice_channel
        self.data["guild_id"] = guild_id
        await interaction.response.defer()
        await play_audio(self.data)
        


async def process_message_queue():
    while True:
        data = await message_queue.get()  # Wait until an audio message is available
        try:
            await send_to_discord(data)  # Play the audio
        except Exception as e:
            print(f"Error playing audio: {e}")
        finally:
            message_queue.task_done()  # Mark the task as done




@bot.event
async def on_member_update(before: discord.Member, after: discord.Member):
    added_roles = [role for role in after.roles if role not in before.roles]
    if added_roles:
        for role in added_roles:
            data = {}
            data["guild_id"] = str(after.guild.id)
            EXPRESS_URL = os.getenv('EXPRESS_URL')
            response = requests.post(f"{EXPRESS_URL}/get-code", json=data)
            url = response.json()["invite_url"]
            qr = qrcode.make(url)
            
            # Save QR code to a buffer
            buffer = BytesIO()
            qr.save(buffer, format="PNG")
            buffer.seek(0)

            # Send the QR code as a DM
            dm_channel = await after.create_dm()
            await dm_channel.send(content=f"Whats-app group invitation link: {url}", file=discord.File(fp=buffer, filename="qrcode.png"))
            
        


@app.route("/send-message", methods=["POST"])
def webhook():
    data = request.get_json()
    
    # Put the request data into the queue instead of playing directly
    bot.loop.call_soon_threadsafe(asyncio.create_task, message_queue.put(data))
    return jsonify({"status": "Message sent to discord"}), 200  

    
        


@bot.event
async def on_guild_join(guild):
    text_channel = await guild.create_text_channel(name="whats-app")  

@bot.event
async def on_guild_remove(guild):
    

    cursor.execute("SELECT * FROM group_binds WHERE ds_id = ?", (guild.id,))
    rows = cursor.fetchall()
    if len(rows) == 0:
        return 500 

    whts_id = str(rows[0][1])
   

    json = {
        "whts_id": whts_id
    }
    EXPRESS_URL = os.getenv('EXPRESS_URL')
    response = requests.post(f"{EXPRESS_URL}/leave", json=json)
    
@bot.listen('on_message')
async def on_message(message):
    
    
    if message.guild:
        if message.content and message.content[0] == '!' or message.channel.name != 'whats-app':
            return
        guild_id = message.guild.id
        if message.author == bot.user:
            return
        
        attachments = message.attachments

        data = dict()
        data["body"] = message.content
        data["attachments"] = []
        data["author"] = message.author.display_name
        data["id"] = str(guild_id)
        
        for _att in attachments:
            if _att.is_voice_message():
                path = f"voice_notes/{uuid.uuid4()}.mp3"
                await _att.save(path)
                data["attachments"].append({"type": "audio", "path": path})
            else:
                data["attachments"].append({"type": "img/file", "url": _att.url})



        EXPRESS_URL = os.getenv('EXPRESS_URL')
        response = requests.post(f"{EXPRESS_URL}/send-message", json=data)
        await bot.process_commands(message)  # Ensures commands still work


    

async def send_to_discord(data):
    
    whts_id = data["id"]

    cursor.execute("SELECT * FROM group_binds WHERE whts_id = ?", (whts_id,))
    rows = cursor.fetchall()
    if len(rows) == 0:
        return 500 

    guild_id = rows[0][2]
    guild = bot.get_guild(int(guild_id))



    if not guild:
        return 500
    
    person = data["author"]
    message = data["body"]
    text_channel = discord.utils.find(lambda c: c.name.lower() == 'whats-app' and isinstance(c, discord.TextChannel), guild.channels)
    if text_channel:
        if 'media' in data:  # Check if image exists
            file = discord.File(data["media"]["path"])
            await text_channel.send(content=f"{person}:\n" + message, file=file)
            if data["media"]["type"] != "voice":
                os.remove(data["media"]["path"])
        else:
            await text_channel.send(content=f"{person}:\n" + message + "\u200B")
        
        if "media" in data and data["media"]["type"] == 'voice':
            view = PlayButtonView(data)  # Use the persistent view
            text_channel = discord.utils.find(lambda c: c.name.lower() == 'whats-app' and isinstance(c, discord.TextChannel), guild.channels)
            await text_channel.send(view=view)

        return 200
    else:
        return 404


async def play_audio(data):

    
    guild_id = data["guild_id"]
    voice_channel  = data["voice_channel"]

    
    if guild_id in voice_clients and voice_clients[guild_id].is_connected():
        voice_client = voice_clients[guild_id]
    else:
        voice_client = await voice_channel.connect()
        voice_clients[guild_id] = voice_client

    
    source = FFmpegPCMAudio(data["media"]["path"])
    if not voice_client.is_playing():
        voice_client.play(source)

    while voice_client.is_playing():
        await asyncio.sleep(1)

    # Disconnect after playing
    await voice_client.disconnect()
    del voice_clients[guild_id]  # Remove from dictionary

    return 200


async def send_verify_to_discord(name):
    guild = bot.guilds[0]
    user = discord.utils.find(lambda u: u.name.lower() == name, guild.members)
    if user:
        try:
            await user.send("Reply here to verify your connection")
            return 200
        except discord.Forbidden:
            return 400
            print("Cannot send message. The user may have DMs disabled.")
    else:
        return 404




@bot.event
async def on_ready():
    bot.loop.create_task(process_message_queue())  # Start processing queue in background
    print(f'Logged in as {bot.user}')


@bot.command()
async def bind(ctx, id):
    
    # if ctx.author.guild_permissions.administrator == False:
    #     await ctx.send(f"Only server administrator can bind")


    cursor.execute("SELECT * FROM group_binds WHERE whts_id = ?", (id,))

    rows = cursor.fetchall()

    if len(rows) == 0:
        await ctx.send(f"Not a valid whats-app group id")


    



    cursor.execute("UPDATE group_binds SET ds_id = ? WHERE whts_id = ?", (ctx.guild.id, id))

    conn.commit()

    if ctx.channel.name == "whats-app":
        await ctx.send(f"ID `{id}` has been bound!")
    





def run_flask():
    app.run(host="0.0.0.0", port=5000)

if __name__ == "__main__":
    import threading

    # Start Flask in a separate thread
    threading.Thread(target=run_flask, daemon=True).start()

    # Run Discord bot
    bot.run(os.getenv('TOKEN'))


##test