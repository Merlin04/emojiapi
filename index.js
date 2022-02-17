const fetch = require("node-fetch");
const FormData = require("form-data");
const {readFile, writeFile, unlink} = require("fs/promises");
const {createWriteStream} = require("fs");
const {pipeline} = require("stream/promises");
require("dotenv").config();

async function downloadFile(url, path) {
    console.log(`Downloading ${url} to ${path}`);
    return pipeline(
        (await fetch(url, {
            method: "GET",
            headers: {
                Cookie: process.env.SLACK_COOKIE
            }
        })).body,
        createWriteStream(path)
    );
}

const express = require("express");
const app = express();

app.use(express.static("emoji"));

let cacheBeingRefreshed = false;

const transformSlackEmojiIndex = index => Object.entries(index).map(([name, url]) => url.startsWith("alias:") ? [name, index[url.slice(6)]] : [name, url]);

async function refreshCache() {
    if (cacheBeingRefreshed) return;
    cacheBeingRefreshed = true;

    const fd = new FormData();
    fd.append("content", "null");
    fd.append("token", process.env.SLACK_BOT_USER_TOKEN);

    const newIndex = await fetch("https://slack.com/api/emoji.list", {
        method: "POST",
        headers: {
            Cookie: process.env.SLACK_COOKIE,
            "Content-Length": fd.getLengthSync().toString(),
            ...fd.getHeaders()
        },
        body: fd.getBuffer()
    }).then(res => res.json());

    if (!newIndex.ok) throw new Error("Slack API returned non-ok response");

    let oldIndex;

    try {
        oldIndex = JSON.parse(await readFile("emoji/index.json").then(b => b.toString()));
    } catch (e) {
        oldIndex = {
            ok: true,
            emoji: {}
        }
    }
    const oldEmojiIndex = transformSlackEmojiIndex(oldIndex.emoji);
    const newEmojiIndex = transformSlackEmojiIndex(newIndex.emoji);

    // Any emojis that are new or have a changed URL
    const newEmojis = newEmojiIndex.filter(([key, url]) => oldEmojiIndex.find(([k]) => k === key)?.[1] !== url);
    // Any emojis that aren't in the new index or have a changed URL
    const emojisToBeDeleted = oldEmojiIndex.filter(([key, url]) => newEmojiIndex.find(([k]) => k === key)?.[1] !== url);

    for (const [name] of emojisToBeDeleted) {
        console.log(`DELETING ${name}`);
        await unlink(`emoji/${name}`);
    }

    for (const [name, url] of newEmojis) {
        await downloadFile(url, `emoji/${name}`);
    }

    // Can't do this, it ddoses the slack api
//    await Promise.all(newEmojis.map(async ([name, url]) => await downloadFile(url, `emoji/${name}`)));

    await writeFile("emoji/index.json", JSON.stringify(newIndex));

    cacheBeingRefreshed = false;
}

app.listen(3000, () => {
    console.log("App listening!");
    refreshCache();

    setInterval(
        refreshCache,
        // Slack docs say this api can be called 20x/min, but I don't want to call it too much
        20 * 1000
    );
})