const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const axios = require("axios");

// Load environment variables from the .env file
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Allow requests from the website
app.use(cors());

// Allow larger requests because resumes are sent as Base64 data
app.use(express.json({ limit: "20mb" }));
app.use(
    express.urlencoded({
        limit: "20mb",
        extended: true,
    })
);

/*
|--------------------------------------------------------------------------
| Basic server test
|--------------------------------------------------------------------------
| Visiting the Render URL should return a message showing that the server
| is running.
*/
app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Pinnacle Tracker server is running.",
    });
});

/*
|--------------------------------------------------------------------------
| Create Tracker resource
|--------------------------------------------------------------------------
*/
app.post("/api/createResource", async (req, res) => {
    console.log("========================================");
    console.log("New website application received");
    console.log("Received at:", new Date().toISOString());

    const { formData, documentData } = req.body;

    try {
        /*
         * Confirm the required environment variables exist.
         */
        if (!process.env.TRACKERRMS_USERNAME) {
            throw new Error(
                "TRACKERRMS_USERNAME is missing from the Render environment variables."
            );
        }

        if (!process.env.TRACKERRMS_PASSWORD) {
            throw new Error(
                "TRACKERRMS_PASSWORD is missing from the Render environment variables."
            );
        }

        /*
         * Confirm the front end sent the expected form structure.
         */
        if (!formData?.trackerrms?.createResource) {
            return res.status(400).json({
                success: false,
                step: "validate-form-data",
                error: "The createResource form data was not received.",
            });
        }

        const createResourceData =
            formData.trackerrms.createResource;

        const applicant =
            createResourceData.resource || {};

        const jobCode =
            createResourceData.instructions
                ?.assigntoopportunity || "";

        console.log(
            "Applicant:",
            applicant.fullname || "No full name received"
        );

        console.log(
            "Email:",
            applicant.email || "No email received"
        );

        console.log(
            "Job code:",
            jobCode || "No job code received"
        );

        /*
         * Add Tracker credentials to the createResource request.
         *
         * This keeps the exact structure from your previously working
         * server.js file.
         */
        createResourceData.credentials = {
            username: process.env.TRACKERRMS_USERNAME,
            password: process.env.TRACKERRMS_PASSWORD,
        };

        /*
        |--------------------------------------------------------------------------
        | STEP 1: Create the resource
        |--------------------------------------------------------------------------
        */

        console.log("Step 1: Creating resource in Tracker...");

        const resourceResponse = await axios.post(
            "https://evoapius.tracker-rms.com/api/widget/createResource",
            formData,
            {
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

        console.log(
            "Tracker createResource response:",
            JSON.stringify(resourceResponse.data, null, 2)
        );

        const recordId = resourceResponse.data.recordId;

        if (!recordId) {
            console.error(
                "Tracker responded but did not return a recordId."
            );

            return res.status(502).json({
                success: false,
                step: "create-resource",
                error:
                    "Tracker did not return a resource record ID.",
                trackerResponse: resourceResponse.data,
            });
        }

        console.log(
            "Resource successfully created. Record ID:",
            recordId
        );

        /*
         * Get information needed for the activity records.
         */
        const localDateTime =
            createResourceData.localDateTime;

        const fullName =
            createResourceData.resource.fullname;

        /*
         * Create the Basic Authorization header used by the other
         * Tracker endpoints.
         */
        const authHeader =
            "Basic " +
            Buffer.from(
                `${process.env.TRACKERRMS_USERNAME}:${process.env.TRACKERRMS_PASSWORD}`
            ).toString("base64");

        /*
        |--------------------------------------------------------------------------
        | STEP 2: Create activity on the resource
        |--------------------------------------------------------------------------
        */

        const activityData1 = {
            trackerrms: {
                createActivity: {
                    activity: {
                        subject: `Filled out application for job ${jobCode}.`,
                        type: "Email",
                        date: localDateTime.date,
                        time: localDateTime.time,
                        status: "Completed",
                        priority: "Medium",
                        contactType: "Outbound",
                        note:
                            "Associated with new resource creation",
                        linkRecordType: "R",
                        linkRecordId: recordId,
                        userId: 3714,
                    },
                },
            },
        };

        console.log(
            "Step 2: Creating activity on the resource..."
        );

        const activityResponse1 = await axios.post(
            "https://evoapius.tracker-rms.com/api/widget/createActivity",
            activityData1,
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: authHeader,
                },
            }
        );

        console.log(
            "Resource activity response:",
            JSON.stringify(activityResponse1.data, null, 2)
        );

        /*
        |--------------------------------------------------------------------------
        | STEP 3: Create activity on the opportunity
        |--------------------------------------------------------------------------
        */

        const activityData2 = {
            trackerrms: {
                createActivity: {
                    activity: {
                        subject: `${fullName} has applied.`,
                        type: "Email",
                        date: localDateTime.date,
                        time: localDateTime.time,
                        status: "Completed",
                        priority: "Medium",
                        contactType: "Outbound",
                        note:
                            "Associated with new resource creation",
                        linkRecordType: "O",
                        linkRecordId: jobCode,
                        userId: 3714,
                    },
                },
            },
        };

        console.log(
            "Step 3: Creating activity on the opportunity..."
        );

        const activityResponse2 = await axios.post(
            "https://evoapius.tracker-rms.com/api/widget/createActivity",
            activityData2,
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: authHeader,
                },
            }
        );

        console.log(
            "Opportunity activity response:",
            JSON.stringify(activityResponse2.data, null, 2)
        );

        /*
        |--------------------------------------------------------------------------
        | STEP 4: Assign the resource to the opportunity
        |--------------------------------------------------------------------------
        */

        const resourceApplicationData = {
            trackerrms: {
                resourceApplication: {
                    credentials: {
                        username:
                            process.env.TRACKERRMS_USERNAME,
                        password:
                            process.env.TRACKERRMS_PASSWORD,
                    },
                    instructions: {
                        opportunityid: jobCode,
                        resourceid: recordId,
                        assigntolist: "short",
                        shortlistedby: "resource",
                        source:
                            createResourceData.resource
                                .source || "Website",
                    },
                },
            },
        };

        console.log(
            "Step 4: Assigning resource to the job..."
        );

        const resourceApplicationResponse =
            await axios.post(
                "https://evoapius.tracker-rms.com/api/widget/resourceApplication",
                resourceApplicationData,
                {
                    headers: {
                        "Content-Type":
                            "application/json",
                        Authorization: authHeader,
                    },
                }
            );

        console.log(
            "Resource application response:",
            JSON.stringify(
                resourceApplicationResponse.data,
                null,
                2
            )
        );

        /*
        |--------------------------------------------------------------------------
        | STEP 5: Attach the resume
        |--------------------------------------------------------------------------
        */

        let documentResponse = null;

        if (documentData) {
            console.log(
                "Step 5: Attaching resume to the resource..."
            );

            if (
                !documentData?.trackerrms
                    ?.attachDocument?.file
            ) {
                return res.status(400).json({
                    success: false,
                    step: "attach-document",
                    error:
                        "Resume data was received, but the attachment file data is missing.",
                    recordId,
                });
            }

            documentData.trackerrms.attachDocument.credentials =
                {
                    username:
                        process.env.TRACKERRMS_USERNAME,
                    password:
                        process.env.TRACKERRMS_PASSWORD,
                };

            documentData.trackerrms.attachDocument.file.recordId =
                recordId;

            documentResponse = await axios.post(
                "https://evoapius.tracker-rms.com/api/widget/attachDocument",
                documentData,
                {
                    headers: {
                        "Content-Type":
                            "application/json",
                        Authorization: authHeader,
                    },
                }
            );

            console.log(
                "Document attachment response:",
                JSON.stringify(
                    documentResponse.data,
                    null,
                    2
                )
            );
        } else {
            console.log(
                "No documentData was received."
            );
        }

        console.log(
            "Application submission completed successfully."
        );

        console.log("Resource ID:", recordId);
        console.log("Job code:", jobCode);
        console.log("========================================");

        return res.status(200).json({
            success: true,
            message:
                "The applicant was created in Tracker.",
            recordId,
            jobCode,
            resource: resourceResponse.data,
            activity1: activityResponse1.data,
            activity2: activityResponse2.data,
            resourceApplication:
                resourceApplicationResponse.data,
            document:
                documentResponse?.data || null,
        });
    } catch (error) {
        console.error(
            "Application submission failed."
        );

        console.error(
            "Error message:",
            error.message
        );

        console.error(
            "Tracker response:",
            JSON.stringify(
                error.response?.data || null,
                null,
                2
            )
        );

        console.error(
            "HTTP status:",
            error.response?.status || "No status"
        );

        console.log("========================================");

        return res.status(500).json({
            success: false,
            step: "tracker-request",
            error: error.message,
            details:
                error.response?.data || null,
            status:
                error.response?.status || null,
        });
    }
});

app.listen(port, () => {
    console.log(
        `Server is running on port ${port}`
    );
});
