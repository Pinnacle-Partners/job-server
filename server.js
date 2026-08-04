const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const axios = require("axios");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const TRACKER_API_BASE =
    "https://evoapius.tracker-rms.com/api/widget";

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(
    express.urlencoded({
        limit: "20mb",
        extended: true,
    })
);

function getTrackerCredentials() {
    return {
        username: process.env.TRACKERRMS_USERNAME,
        password: process.env.TRACKERRMS_PASSWORD,
    };
}

function getAuthorizationHeader() {
    const username = process.env.TRACKERRMS_USERNAME;
    const password = process.env.TRACKERRMS_PASSWORD;

    return (
        "Basic " +
        Buffer.from(`${username}:${password}`).toString("base64")
    );
}

function getAxiosConfig() {
    return {
        headers: {
            "Content-Type": "application/json",
            Authorization: getAuthorizationHeader(),
        },
        timeout: 30000,
    };
}

function getRecordId(responseData) {
    return (
        responseData?.recordId ||
        responseData?.recordid ||
        responseData?.id ||
        responseData?.trackerrms?.createResource?.recordId ||
        responseData?.trackerrms?.createResource?.recordid ||
        responseData?.trackerrms?.createResource?.id ||
        null
    );
}

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        status: "online",
        message: "Pinnacle Tracker submission server is running.",
    });
});

app.post("/api/createResource", async (req, res) => {
    const { formData, documentData } = req.body;

    console.log("========================================");
    console.log("New application received");
    console.log("Time:", new Date().toISOString());

    try {
        /*
         * Validate server environment variables
         */
        if (!process.env.TRACKERRMS_USERNAME) {
            return res.status(500).json({
                success: false,
                step: "server-configuration",
                error:
                    "TRACKERRMS_USERNAME is missing from the server environment variables.",
            });
        }

        if (!process.env.TRACKERRMS_PASSWORD) {
            return res.status(500).json({
                success: false,
                step: "server-configuration",
                error:
                    "TRACKERRMS_PASSWORD is missing from the server environment variables.",
            });
        }

        /*
         * Validate incoming request
         */
        if (
            !formData?.trackerrms?.createResource
        ) {
            return res.status(400).json({
                success: false,
                step: "validate-request",
                error: "The createResource form data is missing.",
            });
        }

        const createResource =
            formData.trackerrms.createResource;

        const resource =
            createResource.resource || {};

        const instructions =
            createResource.instructions || {};

        const jobCode = String(
            instructions.assigntoopportunity || ""
        ).trim();

        const fullName = String(
            resource.fullname || ""
        ).trim();

        const email = String(
            resource.email || ""
        ).trim();

        console.log("Applicant:", fullName || "MISSING");
        console.log("Email:", email || "MISSING");
        console.log("Job code:", jobCode || "MISSING");

        if (!fullName) {
            return res.status(400).json({
                success: false,
                step: "validate-request",
                error: "The applicant's full name is missing.",
            });
        }

        if (!email) {
            return res.status(400).json({
                success: false,
                step: "validate-request",
                error: "The applicant's email address is missing.",
            });
        }

        if (!jobCode) {
            return res.status(400).json({
                success: false,
                step: "validate-job-code",
                error:
                    "No job code was provided. Make sure the application page URL contains ?jobcode= followed by the Tracker job code.",
            });
        }

        /*
         * Add Tracker credentials to createResource request
         */
        createResource.credentials =
            getTrackerCredentials();

        /*
         * STEP 1: Create the resource
         */
        console.log(
            "Step 1: Creating Tracker resource..."
        );

        let resourceResponse;

        try {
            resourceResponse = await axios.post(
                `${TRACKER_API_BASE}/createResource`,
                formData,
                getAxiosConfig()
            );
        } catch (error) {
            console.error(
                "Create resource request failed:",
                error.response?.data || error.message
            );

            return res.status(502).json({
                success: false,
                step: "create-resource",
                error:
                    "Tracker rejected the resource creation request.",
                message: error.message,
                trackerResponse:
                    error.response?.data || null,
            });
        }

        console.log(
            "Create resource response:",
            JSON.stringify(
                resourceResponse.data,
                null,
                2
            )
        );

        const recordId =
            getRecordId(resourceResponse.data);

        if (!recordId) {
            console.error(
                "Tracker did not return a resource record ID."
            );

            return res.status(502).json({
                success: false,
                step: "create-resource",
                error:
                    "Tracker responded, but no resource record ID was returned.",
                trackerResponse:
                    resourceResponse.data,
            });
        }

        console.log(
            "Tracker resource ID:",
            recordId
        );

        /*
         * Determine activity date and time
         */
        const localDateTime =
            createResource.localDateTime || {};

        const currentDate = new Date();

        const activityDate =
            localDateTime.date ||
            currentDate
                .toISOString()
                .slice(0, 10);

        const activityTime =
            localDateTime.time ||
            currentDate
                .toTimeString()
                .slice(0, 5);

        /*
         * STEP 2: Create activity on the resource
         */
        const activityData1 = {
            trackerrms: {
                createActivity: {
                    credentials:
                        getTrackerCredentials(),
                    activity: {
                        subject: `Filled out application for job ${jobCode}.`,
                        type: "Email",
                        date: activityDate,
                        time: activityTime,
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
            "Step 2: Creating resource activity..."
        );

        let activityResponse1;

        try {
            activityResponse1 = await axios.post(
                `${TRACKER_API_BASE}/createActivity`,
                activityData1,
                getAxiosConfig()
            );

            console.log(
                "Resource activity response:",
                JSON.stringify(
                    activityResponse1.data,
                    null,
                    2
                )
            );
        } catch (error) {
            console.error(
                "Resource activity failed:",
                error.response?.data || error.message
            );

            activityResponse1 = {
                data: {
                    success: false,
                    warning:
                        "The resource was created, but the activity on the resource failed.",
                    error:
                        error.response?.data ||
                        error.message,
                },
            };
        }

        /*
         * STEP 3: Create activity on the job/opportunity
         */
        const activityData2 = {
            trackerrms: {
                createActivity: {
                    credentials:
                        getTrackerCredentials(),
                    activity: {
                        subject: `${fullName} has applied.`,
                        type: "Email",
                        date: activityDate,
                        time: activityTime,
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
            "Step 3: Creating opportunity activity..."
        );

        let activityResponse2;

        try {
            activityResponse2 = await axios.post(
                `${TRACKER_API_BASE}/createActivity`,
                activityData2,
                getAxiosConfig()
            );

            console.log(
                "Opportunity activity response:",
                JSON.stringify(
                    activityResponse2.data,
                    null,
                    2
                )
            );
        } catch (error) {
            console.error(
                "Opportunity activity failed:",
                error.response?.data || error.message
            );

            activityResponse2 = {
                data: {
                    success: false,
                    warning:
                        "The resource was created, but the activity on the opportunity failed.",
                    error:
                        error.response?.data ||
                        error.message,
                },
            };
        }

        /*
         * STEP 4: Assign the resource to the job
         */
        const resourceApplicationData = {
            trackerrms: {
                resourceApplication: {
                    credentials:
                        getTrackerCredentials(),
                    instructions: {
                        opportunityid: jobCode,
                        resourceid: recordId,
                        assigntolist: "short",
                        shortlistedby: "resource",
                        source:
                            resource.source ||
                            "Website",
                    },
                },
            },
        };

        console.log(
            "Step 4: Assigning resource to opportunity..."
        );

        let resourceApplicationResponse;

        try {
            resourceApplicationResponse =
                await axios.post(
                    `${TRACKER_API_BASE}/resourceApplication`,
                    resourceApplicationData,
                    getAxiosConfig()
                );

            console.log(
                "Resource application response:",
                JSON.stringify(
                    resourceApplicationResponse.data,
                    null,
                    2
                )
            );
        } catch (error) {
            console.error(
                "Resource application failed:",
                error.response?.data || error.message
            );

            return res.status(502).json({
                success: false,
                step: "resource-application",
                error:
                    "The applicant was created in Tracker, but could not be assigned to the job.",
                recordId,
                jobCode,
                message: error.message,
                trackerResponse:
                    error.response?.data || null,
            });
        }

        /*
         * STEP 5: Attach the resume
         */
        let documentResponse = null;

        if (
            documentData?.trackerrms?.attachDocument
        ) {
            console.log(
                "Step 5: Attaching resume..."
            );

            const attachDocument =
                documentData.trackerrms
                    .attachDocument;

            attachDocument.credentials =
                getTrackerCredentials();

            if (!attachDocument.file) {
                return res.status(400).json({
                    success: false,
                    step: "attach-document",
                    error:
                        "The resume attachment data is missing the file object.",
                    recordId,
                    jobCode,
                });
            }

            attachDocument.file.recordId =
                recordId;

            try {
                documentResponse =
                    await axios.post(
                        `${TRACKER_API_BASE}/attachDocument`,
                        documentData,
                        getAxiosConfig()
                    );

                console.log(
                    "Document response:",
                    JSON.stringify(
                        documentResponse.data,
                        null,
                        2
                    )
                );
            } catch (error) {
                console.error(
                    "Document attachment failed:",
                    error.response?.data ||
                        error.message
                );

                return res.status(502).json({
                    success: false,
                    step: "attach-document",
                    error:
                        "The applicant and job application were created, but the resume could not be attached.",
                    recordId,
                    jobCode,
                    message: error.message,
                    trackerResponse:
                        error.response?.data ||
                        null,
                });
            }
        } else {
            console.log(
                "No resume data was received."
            );
        }

        console.log(
            "Application completed successfully."
        );
        console.log("Resource ID:", recordId);
        console.log("Job code:", jobCode);
        console.log(
            "========================================"
        );

        return res.status(200).json({
            success: true,
            message:
                "The applicant was created and assigned to the Tracker job.",
            recordId,
            jobCode,
            resource: resourceResponse.data,
            activity1:
                activityResponse1?.data || null,
            activity2:
                activityResponse2?.data || null,
            resourceApplication:
                resourceApplicationResponse?.data ||
                null,
            document:
                documentResponse?.data || null,
        });
    } catch (error) {
        console.error(
            "Unexpected submission error:"
        );
        console.error(
            error.response?.data ||
                error.stack ||
                error
        );

        return res.status(500).json({
            success: false,
            step: "unexpected-error",
            error: error.message,
            details:
                error.response?.data || null,
        });
    }
});

app.listen(port, () => {
    console.log(
        `Server is running on port ${port}`
    );
});
