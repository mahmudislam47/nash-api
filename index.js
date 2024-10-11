const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const cheerio = require('cheerio');
const path = require('path');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qs = require('qs');
const getGPT4js = require("gpt4js");
const cron = require('node-cron');
const FormData = require("form-data");
const fs = require('fs');
const app = express();
app.use(cors());
app.set('json spaces', 4);
const PORT = process.env.PORT || 3000;

app.use(express.static('public'))
app.use(express.json());

//simisimi v1
app.get('/simisimi', async (req, res) => {
  const { prompt } = req.query;
  const lang = 'ph';

  const url = 'https://simsimi.vn/web/simtalk';

  const requestData = new URLSearchParams({
    text: prompt,
    lc: lang,
  });

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
  };

  try {
    const response = await axios.post(url, requestData, { headers });

    if (response.data && response.data.success) {
      res.json({ reply: response.data.success });
    } else {
      res.status(500).json({ error: 'Unexpected response structure' });
    }
  } catch (error) {
    res.status(500).json({ error: error.response ? error.response.data : error.message });
  }
});

//llama3-8b-8192
const groq = new Groq({ apiKey: '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' });

app.get('/Llama', async (req, res) => {
  try {
    const query = req.query.q;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: query,
        },
      ],
      model: 'llama3-8b-8192',
    });

    res.json({
      response: chatCompletion.choices[0]?.message?.content || "Walang natanggap na sagot.",
    });
  } catch (error) {
    console.error('Error fetching chat completion:', error);
    res.status(500).json({ error: 'Nabigong makuha ang sagot.' });
  }
});

//mixtral convertional
const CONVERSATION_FILE = path.join(__dirname, 'mixtral.json');

app.use(express.json());

const loadConversations = () => {
  if (fs.existsSync(CONVERSATION_FILE)) {
    return JSON.parse(fs.readFileSync(CONVERSATION_FILE, 'utf8'));
  }
  return {};
};

const saveConversations = (conversations) => {
  fs.writeFileSync(CONVERSATION_FILE, JSON.stringify(conversations, null, 2), 'utf8');
};

app.get('/Mixtral', async (req, res) => {
  const userId = req.query.userId;
  const message = req.query.message;

  if (!userId || !message) {
    return res.status(400).json({ error: 'User ID and message are required.' });
  }

  const conversations = loadConversations();

  if (message.toLowerCase() === 'clear') {
    delete conversations[userId];
    saveConversations(conversations);
    return res.json({ response: 'Conversation cleared.' });
  }

  const history = conversations[userId] || [];

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        ...history,
        {
          role: 'user',
          content: message,
        },
      ],
      model: 'mixtral-8x7b-32768',
    });

    const newMessage = chatCompletion.choices[0]?.message?.content || 'No response received.';
    conversations[userId] = [
      ...history,
      {
        role: 'user',
        content: message,
      },
      {
        role: 'assistant',
        content: newMessage,
      },
    ];

    saveConversations(conversations);

    res.json({
      response: newMessage,
    });
  } catch (error) {
    console.error('Error fetching chat completion:', error);
    res.status(500).json({ error: 'Failed to fetch response.' });
  }
});

//imgur
const isValidUrl = (string) => {
  try {
    return isUrl(string);
  } catch (err) {
    return false;
  }
};

app.get('/upload', async (req, res) => {
  const { image } = req.query;

  if (!image) {
    return res.status(400).json({ error: 'Please provide an image path or URL as a query parameter.' });
  }

  const clientId = 'e4f58fc81daec99';
  const url = 'https://api.imgur.com/3/image';

  try {
    let imageData;

    if (isValidUrl(image)) {
      const imageResponse = await axios.get(image, { responseType: 'arraybuffer' });
      imageData = Buffer.from(imageResponse.data).toString('base64');
    } else {
      const fullPath = path.resolve(image);
      imageData = fs.readFileSync(fullPath, { encoding: 'base64' });
    }

    const headers = {
      'Authorization': `Client-ID ${clientId}`,
    };

    const response = await axios.post(
      url,
      { image: imageData },
      { headers }
    );

    if (response.data && response.data.success) {
      res.json({ success: true, link: response.data.data.link });
    } else {
      res.status(500).json({ error: 'Image upload failed', details: response.data });
    }
  } catch (error) {
    res.status(500).json({ error: 'An error occurred', details: error.response ? error.response.data : error.message });
  }
});

//google news
async function gnews(query) {
  try {
    const url = `https://news.google.com/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN%3Aen`;
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.100 Safari/537.36"
      }
    });

    const $ = cheerio.load(data);
    const list = $("c-wiz div main div c-wiz c-wiz c-wiz article");
    const news = [];

    list.each((idx, el) => {
      const title = $(el).find("h3").text().trim();
      const time = $(el).find("time").text().trim();
      const date = $(el).find("time").attr("datetime");
      const author = $(el).find("span").first().text().trim() || "Anonymous";

      const imgAttr = $(el).find("figure img").last().attr("srcset");
      const img = imgAttr ? imgAttr.split(" ") : ["https://upload.wikimedia.org/wikipedia/commons/d/d1/Image_not_available.png"];

      const link = "https://news.google.com" + $(el).find("a").attr("href").slice(1);
      const source = $(el).find(".wEwyrc").text().trim() || "Unknown Source";

      news.push({
        title,
        time,
        date,
        author,
        img: img[0],
        link,
        source,
      });
    });

    return news;

  } catch (error) {
    throw new Error(error.message);
  }
}

app.get("/googlenews", async (req, res) => {
  const query = req.query.q;

  if (!query) {
    return res.status(400).json({ error: "Query parameter 'q' is required." });
  }

  try {
    const news = await gnews(query);
    return res.json({ articles: news });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

//any model
async function aiArtGenerator(prompt) {
  try {
    const formData = new URLSearchParams({
      prompt: prompt,
      output_format: "bytes",
      user_profile_id: "null",
      anonymous_user_id: "a584e30d-1996-4598-909f-70c7ac715dc1",
      request_timestamp: Date.now(),
      user_is_subscribed: "false",
      client_id: "pSgX7WgjukXCBoYwDM8G8GLnRRkvAoJlqa5eAVvj95o",
    });

    const response = await axios.post(
      "https://ai-api.magicstudio.com/api/ai-art-generator",
      formData.toString(),
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
          Accept: "application/json, text/plain, */*",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "en-US,en;q=0.9",
          Origin: "https://magicstudio.com",
          Referer: "https://magicstudio.com/ai-art-generator/",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        responseType: "arraybuffer",
      }
    );

    return response.data;
  } catch (error) {
    throw new Error(error.message);
  }
}

app.get("/generate-art", async (req, res) => {
  const prompt = req.query.prompt;
  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  const filePath = path.join(__dirname, "art.png");

  try {
    const aiArt = await aiArtGenerator(prompt);
    fs.writeFileSync(filePath, Buffer.from(aiArt, "utf8"));
    
    const imageUrl = `${req.protocol}://${req.get('host')}/art.png`;
    res.json({ message: "Art generated successfully!", imageUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/art.png", (req, res) => {
  const filePath = path.join(__dirname, "art.png");
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(err.status).end();
    }
  });
});

//nashbot
app.get('/nashbot', async (req, res) => {
  try {
    const query = req.query.q;

    const messages = [
      {
        role: 'system',
        content: "You are Nashbot, an advanced AI from the Nash Team. I love to joke around and answer your questions. Sometimes, I get creative, so feel free to engage with me!"
      },
      { role: 'user', content: query },
    ];

    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: 'llama3-8b-8192',
    });

    const responseMessage = chatCompletion.choices[0]?.message?.content;

    if (responseMessage) {
      res.json({ response: responseMessage.replace(/Facebook AI/g, 'Nash Team') });
    } else {
      res.json({ response: "No response received. How can I assist you further?" });
    }
  } catch (error) {
    console.error('Error fetching chat completion:', error);
    res.status(500).json({ error: 'Failed to retrieve the response. Please try again.' });
  }
});

//roasted ai
app.get('/roasted/ai', async (req, res) => {
  const prompt = req.query.prompt;

  if (!prompt) {
    return res.status(400).send('Please provide a prompt.');
  }

  const url = 'https://roastedby.ai/api/generate';
  const requestData = {
    userMessage: {
      role: 'user',
      content: prompt
    },
    history: [],
    style: 'adult'
  };

  try {
    const response = await axios.post(url, requestData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    res.send(response.data.content);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

//blackbox
app.get('/blackbox', async (req, res) => {
  const userPrompt = req.query.prompt;

  if (!userPrompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  const url = 'https://www.blackbox.ai/api/chat';
  const requestData = {
    messages: [
      {
        id: "h0xRhYGa9Ie4uU97t47kl",
        content: userPrompt,
        role: "user"
      }
    ],
    id: "h0xRhYGa9Ie4uU97t47kl",
    previewToken: null,
    userId: null,
    codeModelMode: true,
    agentMode: {
      mode: true,
      id: "ImageGenerationLV45LJp",
      name: "Image Generation"
    },
    trendingAgentMode: {},
    isMicMode: false,
    maxTokens: 1024,
    playgroundTopP: null,
    playgroundTemperature: null,
    isChromeExt: false,
    githubToken: null,
    clickedAnswer2: false,
    clickedAnswer3: false,
    clickedForceWebSearch: false,
    visitFromDelta: false,
    mobileClient: false,
    userSelectedModel: null
  };

  const headers = {
    'Content-Type': 'application/json',
  };

  try {
    const response = await axios.post(url, requestData, { headers });
    if (response.data) {
      const cleanedResponse = response.data.replace(/\$@\$\w+=undefined-rv1\$@\$/g, '');
      return res.json({ response: cleanedResponse });
    } else {
      return res.status(500).json({ error: 'Unexpected response structure.' });
    }
  } catch (error) {
    console.error('Error while fetching BlackBox:', error.response ? error.response.data : error.message);
    return res.status(500).json({ error: 'Error while fetching BlackBox.' });
  }
});

//ss site
const API_KEY = '254572';

app.get('/screenshot', (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const screenshotURL = `https://api.screenshotmachine.com?key=${API_KEY}&url=${encodeURIComponent(url)}&dimension=1024x768`;

  res.json({ screenshotURL });
});

//gemini
const apiKey = process.env.API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

app.get('/gemini', async (req, res) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = req.query.prompt;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt query parameter is required' });
    }

    const result = await model.generateContent(prompt);
    const response = result.response;

    res.json({ 
      author: "NashBot",
      response: response.text() 
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'An error occurred while generating content' });
  }
});

//gen image
const styles = [
  "Hyper-Surreal Escape",
  "Neon Fauvism",
  "Post-Analog Glitchscape",
  "AI Dystopia",
  "Vivid Pop Explosion"
];

const fetchImage = async (prompt, styleIndex) => {
  try {
    const formData = new FormData();
    formData.append("field-0", prompt);
    formData.append("field-1", styles[styleIndex - 1]);

    const response = await axios.post("https://devrel.app.n8n.cloud/form/flux", formData, {
      headers: {
        ...formData.getHeaders(),
        Accept: "*/*",
        "User-Agent": "Postify/1.0.0"
      }
    });

    const data = response.data;
    const $ = cheerio.load(data);
    return {
      image: $(".image-container img").attr("src"),
      style: $(".style-text").text().replace("Style: ", "")
    };
  } catch (error) {
    throw new Error(error.message);
  }
};

app.get("/generate-image", async (req, res) => {
  const { prompt, styleIndex } = req.query;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  const index = styleIndex ? parseInt(styleIndex) : Math.floor(Math.random() * styles.length) + 1;

  try {
    const imageUrl = await fetchImage(prompt, index);
    return res.json(imageUrl);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

//Gen image with any model
const CREATE_URL = 'https://arting.ai/api/cg/text-to-image/demo/create';
const GET_URL = 'https://arting.ai/api/cg/text-to-image/demo/get';

const VALID_MODELS = [
    "dark-sushi-25d",
    "pastel-mixed",
    "revanimated",
    "dreamshaper-v8",
    "rev-anim",
    "pastel-2"
];

app.get('/Gen-image', async (req, res) => {
    const { prompt, model } = req.query;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    if (!model || !VALID_MODELS.includes(model)) {
        return res.status(400).json({ error: `Model is required and must be one of the following: ${VALID_MODELS.join(', ')}` });
    }

    const payload = {
        prompt,
        model_id: model,
        model_type: "sd",
        style: "",
        samples: "1",
        height: 1024,
        width: 1024,
        negative_prompt: "Sexy female nuns , holding machine guns , masterpiece, highly detailed, 4k , showing some bare, garter belts made of bullets , realistic, crucifix around necks, perfect, no malformation, beautiful",
        num_inference_steps: 0,
        guidance_scale: 0,
        seed: 0,
        lora_model_id: "more_details",
        lora_strength: 0.7,
        safety_checker: "yes",
        safety_checker_type: ""
    };

    try {
        const createResponse = await axios.post(CREATE_URL, payload);
        const request_id = createResponse.data.data.request_id;

        const imageResponse = await axios.post(GET_URL, { request_id, model_id: "sdxl" }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            }
        });

        const imageUrl = imageResponse.data.data.output[0];
        res.json({ imageUrl, createResponse: createResponse.data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

//gemma-7b-it
app.get('/gemma', async (req, res) => {
  const prompt = req.query.prompt;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: 'gemma-7b-it',
    });

    const responseMessage = chatCompletion.choices[0]?.message?.content || 'No response received.';

    res.json({
      response: responseMessage,
    });
  } catch (error) {
    console.error('Error fetching chat completion:', error);
    res.status(500).json({ error: 'Failed to fetch response.' });
  }
});

//llava
app.get('/llava', async (req, res) => {
  try {
    const query = req.query.q;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: query,
        },
      ],
      model: 'llava-v1.5-7b-4096-preview',
    });

    res.json({
      response: chatCompletion.choices[0]?.message?.content || "No response received.",
    });
  } catch (error) {
    console.error('Error fetching chat completion:', error);
    res.status(500).json({ error: 'Failed to fetch response.' });
  }
});

//Genderize
app.get('/gender', async (req, res) => {
    const { name } = req.query;

    if (!name) {
        return res.status(400).json({
            error: 'Please provide a name query parameter using the format: /gender?name=<name>. For example, /gender?name=Joshua'
        });
    }

    try {
        const response = await axios.get(`https://api.genderize.io`, {
            params: { name }
        });

        res.json({
            status: response.data.gender ? 'success' : 'not found',
            name,
            gender: response.data.gender,
            probability: response.data.probability,
            count: response.data.count
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while fetching the gender. Please try again later.' });
    }
});

//cat-image
app.get('/cat-image', async (req, res) => {
  try {
    const response = await axios.get('https://api.thecatapi.com/v1/images/search');
    res.json(response.data[0]);
  } catch (error) {
    res.status(500).send('Error fetching cat image');
  }
});

//random dog image
app.get('/random-dog-image', async (req, res) => {
  try {
    const response = await axios.get('https://random.dog/woof.json');
    res.json(response.data);
  } catch (error) {
    res.status(500).send('Error fetching random dog image');
  }
});

//dog fact
app.get('/dog-fact', async (req, res) => {
  try {
    const response = await axios.get('https://dog-api.kinduff.com/api/facts');
    res.json(response.data);
  } catch (error) {
    res.status(500).send('Error fetching dog fact');
  }
});

//cat fact
app.get('/cat-fact', async (req, res) => {
  try {
    const response = await axios.get('https://meowfacts.herokuapp.com/');
    res.json(response.data);
  } catch (error) {
    res.status(500).send('Error fetching cat fact');
  }
});

//random meme
app.get('/random-meme', async (req, res) => {
  try {
    const response = await axios.get('https://api.imgflip.com/get_memes');
    const memes = response.data.data.memes;

    const randomIndex = Math.floor(Math.random() * memes.length);
    const randomMeme = memes[randomIndex];

    res.json({
      id: randomMeme.id,
      name: randomMeme.name,
      url: randomMeme.url
    });
  } catch (error) {
    res.status(500).send('Error fetching meme data');
  }
});

//bible random
app.get('/random-bible-verse', async (req, res) => {
    try {
        const response = await axios.get(`https://labs.bible.org/api/?passage=random`);

        res.json({ verse: response.data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
});

//emojimix
app.get('/emojimix', async (req, res) => {
  const x = req.query.one;
  const y = req.query.two;

  if (!x || !y) {
    return res.status(400).json({ error: 'Missing query parameters' });
  }

  const url = `https://tenor.googleapis.com/v2/featured?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${x}_${y}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (data.error) {
      res.status(response.status).json(data);
    } else if (data.locale === '') {
      res.status(404).json(data);
    } else {
      res.status(200).json(data);
    }
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

//waifu
app.get('/waifu', async (req, res) => {
  const searchQuery = req.query.search;

  if (!searchQuery) {
    return res.status(400).send('Search query parameter is required');
  }

  const url = `https://api.waifu.im/search?q=${encodeURIComponent(searchQuery)}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    res.set('Access-Control-Allow-Origin', '*');

    res.json({ 
      data,
      message: "Developed by Joshua Apostol"
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('An error occurred while fetching the data');
  }
});

//Qoute
app.get('/quote', async (req, res) => {
  try {
    const response = await axios.get('https://quotes.toscrape.com');
    const html = response.data;
    const $ = cheerio.load(html);
    const quotes = [];

    $('.quote').each((index, element) => {
      const quoteText = $(element).find('.text').text();
      const quoteAuthor = $(element).find('.author').text();
      quotes.push({ text: quoteText, author: quoteAuthor });
    });

    const randomIndex = Math.floor(Math.random() * quotes.length);
    res.json(quotes[randomIndex]);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('An error occurred while fetching the quote');
  }
});

//ngl spam
async function sendNglMessage(username, message) {
  const url = 'https://ngl.link/api/submit';
  const requestData = {
    username,
    question: message,
    deviceId: ''
  };

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Accept': '*/*',
    'X-Requested-With': 'XMLHttpRequest'
  };

  try {
    await axios.post(url, qs.stringify(requestData), { headers });
  } catch (error) {
  }
}

function spamNgl(username, message, amount) {
  let count = 0;

  function spam() {
    if (count < amount) {
      sendNglMessage(username, message);
      count++;
      const interval = Math.random() * 1000 + 1000;
      setTimeout(spam, interval);
    }
  }

  spam();
}

app.get('/ngl-spam', (req, res) => {
  const { username, message, amount } = req.query;
  
  if (!username || !message || !amount) {
    return res.status(400).send('Username, message, and amount are required.');
  }

  const messageCount = parseInt(amount, 10);
  if (isNaN(messageCount) || messageCount <= 0) {
    return res.status(400).send('Amount must be a positive number.');
  }

  res.send(`Started spamming NGL to ${username} with message: "${message}" for ${messageCount} times.`);
  spamNgl(username, message, messageCount);
});

//img uploader
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/upload2', async (req, res) => {
  const imageUrl = req.query.image;

  if (!imageUrl) {
    return res.status(400).send('No image provided.');
  }

  const filename = `${Date.now()}-${path.basename(imageUrl)}`;
  const filePath = path.join(__dirname, 'uploads', filename);

  if (imageUrl.startsWith('http')) {
    try {
      const response = await axios({
        method: 'get',
        url: imageUrl,
        responseType: 'stream',
      });

      response.data.pipe(fs.createWriteStream(filePath));

      response.data.on('end', () => {
        res.json({ imageUrl: `${req.protocol}://${req.get('host')}/uploads/${filename}` });
      });

      response.data.on('error', (err) => {
        res.status(500).send(`Error fetching the image: ${err.message}`);
      });
    } catch (err) {
      res.status(500).send(`Error fetching the image: ${err.message}`);
    }
  } else {
    fs.copyFile(imageUrl, filePath, (err) => {
      if (err) {
        return res.status(500).send(`Error saving the local image: ${err.message}`);
      }
      res.json({ imageUrl: `${req.protocol}://${req.get('host')}/uploads/${filename}` });
    });
  }
});

//blackbox gpt4o
app.get('/blackbox/model/gpt4o', async (req, res) => {
  const { prompt } = req.query;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const requestData = {
    messages: [
      {
        role: 'system',
        content: 'I am GPT-4o, here to assist you.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    id: '',
    previewToken: null,
    userId: null,
    codeModelMode: true,
    agentMode: {},
    trendingAgentMode: {},
    isMicMode: false,
    userSystemPrompt: null,
    maxTokens: 1024,
    playgroundTopP: 0.9,
    playgroundTemperature: 0.5,
    isChromeExt: false,
    githubToken: null,
    clickedAnswer2: false,
    clickedAnswer3: false,
    clickedForceWebSearch: false,
    visitFromDelta: false,
    mobileClient: false,
    userSelectedModel: 'gpt-4o'
  };

  try {
    const response = await axios.post('https://www.blackbox.ai/api/chat', requestData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    let cleanData = response.data.replace(/\$@\$.+?\$@\$/g, '');
    res.json({ response: cleanData });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Blackbox AI' });
  }
});

//blackbox pro
app.get('/blackbox/model/blackboxai-pro', async (req, res) => {
  const { prompt } = req.query;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const requestData = {
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    id: 'jNl98gC',
    previewToken: null,
    userId: null,
    codeModelMode: true,
    agentMode: {},
    trendingAgentMode: {},
    isMicMode: false,
    userSystemPrompt: null,
    maxTokens: 1024,
    playgroundTopP: 0.9,
    playgroundTemperature: 0.5,
    isChromeExt: false,
    githubToken: null,
    clickedAnswer2: false,
    clickedAnswer3: false,
    clickedForceWebSearch: false,
    visitFromDelta: false,
    mobileClient: false,
    userSelectedModel: 'blackboxai-pro'
  };

  try {
    const response = await axios.post('https://www.blackbox.ai/api/chat', requestData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    let cleanData = response.data.replace(/\$@\$.+?\$@\$/g, '');
    res.json({ response: cleanData });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Blackbox AI' });
  }
});

//gpt4o
app.get('/gpt4o', async (req, res) => {
  const { prompt } = req.query;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const data = JSON.stringify({
    messageList: [
      {
        senderType: "BOT",
        content: "Hi there! How can I help you today?"
      },
      {
        type: "TEXT",
        content: prompt,
        senderType: "USER",
        files: []
      }
    ],
    fileIds: [],
    threadId: "thread_lGY4BEYXStiAR2jpPAnOq2kF"
  });

  const config = {
    method: 'POST',
    url: 'https://markbot-10923.chipp.ai/api/openai/chat',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Content-Type': 'application/json',
      'sec-ch-ua-platform': '"Android"',
      'sec-ch-ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
      'sec-ch-ua-mobile': '?1',
      'Origin': 'https://markbot-10923.chipp.ai',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Referer': 'https://markbot-10923.chipp.ai/',
      'Accept-Language': 'en-US,en;q=0.9,fil;q=0.8'
    },
    data: data
  };

  try {
    const response = await axios.request(config);
    const message = response.data; 
    res.json({ response: message });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data from Markbot API' });
  }
});

//blackbox gemini
app.get('/blackbox/model/gemini-pro', async (req, res) => {
  const { prompt } = req.query;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const requestData = {
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    id: 'nebblEx',
    previewToken: null,
    userId: null,
    codeModelMode: true,
    agentMode: {},
    trendingAgentMode: {},
    isMicMode: false,
    userSystemPrompt: null,
    maxTokens: 1024,
    playgroundTopP: 0.9,
    playgroundTemperature: 0.5,
    isChromeExt: false,
    githubToken: null,
    clickedAnswer2: false,
    clickedAnswer3: false,
    clickedForceWebSearch: false,
    visitFromDelta: false,
    mobileClient: false,
    userSelectedModel: 'gemini-pro'
  };

  try {
    const response = await axios.post('https://www.blackbox.ai/api/chat', requestData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    res.json({ response: response.data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data from Blackbox AI' });
  }
});

app.get('/blackbox/model/claude-sonnet-3.5', async (req, res) => {
  const { prompt } = req.query;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const requestData = {
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    id: 'qw3aPpH',
    previewToken: null,
    userId: null,
    codeModelMode: true,
    agentMode: {},
    trendingAgentMode: {},
    isMicMode: false,
    userSystemPrompt: null,
    maxTokens: 1024,
    playgroundTopP: 0.9,
    playgroundTemperature: 0.5,
    isChromeExt: false,
    githubToken: null,
    clickedAnswer2: false,
    clickedAnswer3: false,
    clickedForceWebSearch: false,
    visitFromDelta: false,
    mobileClient: false,
    userSelectedModel: 'claude-sonnet-3.5'
  };

  try {
    const response = await axios.post('https://www.blackbox.ai/api/chat', requestData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    res.json({ response: response.data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data from Blackbox AI' });
  }
});

//gpt4o
app.get('/gpt4o-v2', (req, res) => {
    const ask = req.query.ask;
    const id = req.query.id;

    if (!ask || !id || isNaN(id)) {
        return res.status(400).json({ status: false, owner: "joshua Apostol", error: 'Both "ask" and "id" parameters are required and "id" must be a number' });
    }

    const numericId = Number(id);
    
    fs.readFile(`./${numericId}.json`, 'utf8', (err, data) => {
        let messages = [];
        if (err) {
            console.warn(`No previous conversation found for ID: ${numericId}. Initializing new conversation.`);
            messages = [{ role: "system", content: "You're a math teacher." }];
            fs.writeFile(`./${numericId}.json`, JSON.stringify({ messages, lastInteraction: Date.now() }, null, 2), () => {});
        } else {
            const parsedData = JSON.parse(data);
            messages = Array.isArray(parsedData.messages) ? parsedData.messages : [];
        }

        messages.push({ role: "user", content: ask });

        const options = {
            provider: "Nextway",
            model: "gpt-4o-free",
            temperature: 0.5,
            webSearch: true
        };

        getGPT4js().then(async (GPT4js) => {
            const provider = GPT4js.createProvider(options.provider);
            const response = await provider.chatCompletion(messages, options);

            messages.push({ role: "assistant", content: response });
            fs.writeFile(`./${numericId}.json`, JSON.stringify({ messages, lastInteraction: Date.now() }, null, 2), () => {});
            res.json({ status: true, owner: "joshua Apostol", response });
        }).catch(error => {
            console.error('Error during chat completion or file writing:', error);
            res.status(500).json({ status: false, owner: "joshua Qpostol", error: 'Internal Server Error' });
        });
    });
});

cron.schedule('* * * * *', async () => {
    const directory = './';
    fs.readdir(directory, (err, files) => {
        if (err) return console.error(err);
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        files.forEach((file) => {
            if (path.extname(file) === '.json') {
                fs.readFile(path.join(directory, file), 'utf8', (err, data) => {
                    if (err) return console.error(err);
                    const parsedData = JSON.parse(data);
                    const lastInteraction = parsedData.lastInteraction;

                    if (lastInteraction < oneHourAgo) {
                        fs.unlink(path.join(directory, file), (err) => {
                            if (err) return console.error(err);
                            console.log(`Deleted old JSON file: ${file}`);
                        });
                    }
                });
            }
        });
    });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});