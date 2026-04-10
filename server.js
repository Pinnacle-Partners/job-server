const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');

dotenv.config();

const requiredEnvVars = ['TRACKERRMS_USERNAME', 'TRACKERRMS_PASSWORD'];
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);

if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

function buildAuthHeader() {
  return (
    'Basic ' +
    Buffer.from(
      `${process.env.TRACKERRMS_USERNAME}:${process.env.TRACKERRMS_PASSWORD}`
    ).toString('base64')
  );
}

function validateCreateResourcePayload(req, res, next) {
  const { formData, documentData } = req.body;

  if (!formData || typeof formData !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid formData' });
  }

  if (
    !formData.trackerrms ||
    !formData.trackerrms.createResource ||
    !formData.trackerrms.createResource.resource ||
    !formData.trackerrms.createResource.instructions
  ) {
    return res.status(400).json({
      error: 'Invalid formData structure',
    });
  }

  const resource = formData.trackerrms.createResource.resource;
  const localDateTime = formData.trackerrms.createResource.localDateTime;

  if (!resource.firstname || !resource.lastname || !resource.email) {
    return res.status(400).json({
      error: 'Missing required resource fields: firstname, lastname, or email',
    });
  }

  if (
    !localDateTime ||
    !localDateTime.date ||
    !localDateTime.time
  ) {
    return res.status(400).json({
      error: 'Missing localDateTime.date or localDateTime.time',
    });
  }

  if (documentData) {
    if (
      !documentData.trackerrms ||
      !documentData.trackerrms.attachDocument ||
      !documentData.trackerrms.attachDocument.file
    ) {
      return res.status(400).json({
        error: 'Invalid documentData structure',
      });
    }
  }

  next();
}

app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'job-server' });
});

app.post('/api/createResource', validateCreateResourcePayload, async (req, res) => {
  try {
    const { formData, documentData } = req.body;

    formData.trackerrms.createResource.credentials = {
      username: process.env.TRACKERRMS_USERNAME,
      password: process.env.TRACKERRMS_PASSWORD,
    };

    const authHeader = buildAuthHeader();

    const resourceResponse = await axios.post(
      'https://evoapius.tracker-rms.com/api/widget/createResource',
      formData,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
      }
    );

    const recordId = resourceResponse.data.recordId;
    const jobCode =
      formData.trackerrms.createResource.instructions.assigntoopportunity;
    const { localDateTime } = formData.trackerrms.createResource;
    const fullName = formData.trackerrms.createResource.resource.fullname;

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
            assigntolist: 'short',
            shortlistedby: 'resource',
            source: 'Website',
          },
        },
      },
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

    let documentResult = null;

    if (documentData) {
      documentData.trackerrms.attachDocument.credentials = {
        username: process.env.TRACKERRMS_USERNAME,
        password: process.env.TRACKERRMS_PASSWORD,
      };

      documentData.trackerrms.attachDocument.file.recordId = recordId;

      const documentResponse = await axios.post(
        'https://evoapius.tracker-rms.com/api/widget/attachDocument',
        documentData,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
        }
      );

      documentResult = documentResponse.data;
    }

    return res.status(200).json({
      resource: resourceResponse.data,
      activity1: activityResponse1.data,
      activity2: activityResponse2.data,
      resourceApplication: resourceApplicationResponse.data,
      ...(documentResult && { document: documentResult }),
    });
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status || 500).json({
        error: 'Tracker RMS API request failed',
        details: error.response.data,
      });
    }

    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
