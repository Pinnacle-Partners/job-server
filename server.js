const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(express.json());
const upload = multer(); // For handling file uploads

app.get('/credentials', (req, res) => {
    const username = process.env.TRACKERRMS_USERNAME;
    const password = process.env.TRACKERRMS_PASSWORD;

    if (!username || !password) {
        return res.status(500).json({
            error: 'Failed to load credentials from environment variables',
        });
    }

    res.json({
        username: username,
        password: password,
    });
});

app.post('/api/createResource', upload.single('file'), async (req, res) => {
    const { formData } = req.body;
    const documentFile = req.file;

    formData.trackerrms.createResource.credentials = {
        username: process.env.TRACKERRMS_USERNAME,
        password: process.env.TRACKERRMS_PASSWORD,
    };

    try {
        // First API call to create the resource
        const resourceResponse = await axios.post(
            'https://evoapius.tracker-rms.com/api/widget/createResource',
            formData,
            { headers: { 'Content-Type': 'application/json' } }
        );

        const recordId = resourceResponse.data.recordId;

        const jobCode = formData.trackerrms.createResource.instructions.assigntoopportunity;

        // Use the local date and time from the client
        const { localDateTime } = formData.trackerrms.createResource;
        const fullName = formData.trackerrms.createResource.resource.fullname;


        if (documentFile) {
            // Prepare form-data for file upload
            const form = new FormData();
            form.append('file', documentFile.buffer, {
                filename: documentFile.originalname,
                contentType: documentFile.mimetype,
            });
            form.append('recordId', recordId);

            const documentResponse = await axios.post(
                'https://evoapius.tracker-rms.com/api/widget/attachDocument',
                form,
                {
                    headers: {
                        ...form.getHeaders(),
                        Authorization: 'Basic ' + Buffer.from(
                            `${process.env.TRACKERRMS_USERNAME}:${process.env.TRACKERRMS_PASSWORD}`
                        ).toString('base64'),
                    },
                }
            );

            res.status(200).json({
                resource: resourceResponse.data,
                activity1: activityResponse1.data,
                activity2: activityResponse2.data,
                resourceApplication: resourceApplicationResponse.data,
                document: documentResponse.data,
            });
        } else {
            res.status(200).json({
                resource: resourceResponse.data,
                activity1: activityResponse1.data,
                activity2: activityResponse2.data,
                resourceApplication: resourceApplicationResponse.data,
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
