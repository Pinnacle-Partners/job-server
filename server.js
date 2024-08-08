const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');
const FormData = require('form-data');

// Load environment variables from .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/credentials', (req, res) => {
    const username = process.env.TRACKERRMS_USERNAME;
    const password = process.env.TRACKERRMS_PASSWORD;

    if (!username || !password) {
        return res.status(500).json({
            error: 'Failed to load credentials from environment variables',
        });
    }

    res.json({ username, password });
});

app.post('/api/createResource', async (req, res) => {
    const { formData, documentData } = req.body;
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
        const { localDateTime } = formData.trackerrms.createResource;
        const fullName = formData.trackerrms.createResource.resource.fullname;

        // First activity data
        const activityData1 = {
            trackerrms: {
                createActivity: {
                    activity: {
                        subject: `Filled out application for job ${jobCode}.`,
                        type: 'Email',
                        date: localDateTime.date,
                        time: localDateTime.time,
                        status: 'Completed',
                        priority: 'Medium',
                        contactType: 'Outbound',
                        note: 'Associated with new resource creation',
                        linkRecordType: 'R',
                        linkRecordId: recordId,
                    },
                },
            },
        };

        // Second activity data
        const activityData2 = {
            trackerrms: {
                createActivity: {
                    activity: {
                        subject: `${fullName} has applied.`,
                        type: 'Email',
                        date: localDateTime.date,
                        time: localDateTime.time,
                        status: 'Completed',
                        priority: 'Medium',
                        contactType: 'Outbound',
                        note: 'Associated with new resource creation',
                        linkRecordType: 'O',
                        linkRecordId: jobCode,
                    },
                },
            },
        };

        // Authorization header
        const authHeader = 'Basic ' + Buffer.from(
            `${process.env.TRACKERRMS_USERNAME}:${process.env.TRACKERRMS_PASSWORD}`
        ).toString('base64');

        // Second API call to create first activity
        const activityResponse1 = await axios.post(
            'https://evoapius.tracker-rms.com/api/widget/createActivity',
            activityData1,
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: authHeader,
                },
            }
        );

        // Third API call to create second activity
        const activityResponse2 = await axios.post(
            'https://evoapius.tracker-rms.com/api/widget/createActivity',
            activityData2,
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: authHeader,
                },
            }
        );

        // Third API call to assign resource to the job as applied
        const resourceApplicationData = {
            trackerrms: {
                resourceApplication: {
                    credentials: {
                        username: process.env.TRACKERRMS_USERNAME,
                        password: process.env.TRACKERRMS_PASSWORD,
                    },
                    instructions: {
                        opportunityid: jobCode,
                        resourceid: recordId,
                        assigntolist: "short", 
                        shortlistedby: "resource",
                        source: "Website",
                    }
                }
            }
        };

        const resourceApplicationResponse = await axios.post(
            'https://evoapius.tracker-rms.com/api/widget/resourceApplication',
            resourceApplicationData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: authHeader,
                },
            }
        );

        // Attach document if provided
        if (documentData) {
            const formData = new FormData();
            formData.append('file', documentData.trackerrms.attachDocument.file);
            formData.append('recordId', recordId);
            formData.append('username', process.env.TRACKERRMS_USERNAME);
            formData.append('password', process.env.TRACKERRMS_PASSWORD);

            const documentResponse = await axios.post(
                'https://evoapius.tracker-rms.com/api/widget/attachDocument',
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                        Authorization: authHeader,
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
