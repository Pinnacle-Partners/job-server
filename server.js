const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const TRACKER_BASE_URL =
    'https://evoapius.tracker-rms.com/api/widget';

const TRACKER_USER_ID = 3714;
const MAXIMUM_RESUME_SIZE = 10 * 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(
    express.urlencoded({
        limit: '20mb',
        extended: true,
    })
);

function cleanString(value, maximumLength = 500) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().slice(0, maximumLength);
}

function getTrackerStatus(data) {
    return Number(data?.status);
}

function trackerSucceeded(data) {
    return getTrackerStatus(data) === 0;
}

function getRecordId(data) {
    return (
        data?.recordId ||
        data?.recordid ||
        data?.resourceId ||
        data?.resourceid ||
        data?.ResourceId ||
        data?.ResourceID ||
        data?.id ||
        data?.Id ||
        null
    );
}

function buildResumeCredentials() {
    return {
        username:
            process.env.TRACKERRMS_USERNAME,
        password:
            process.env.TRACKERRMS_PASSWORD,
        apikey:
            process.env.TRACKERRMS_API_KEY,
    };
}

function buildBasicAuthorizationHeader() {
    return (
        'Basic ' +
        Buffer.from(
            `${process.env.TRACKERRMS_USERNAME}:${process.env.TRACKERRMS_PASSWORD}`
        ).toString('base64')
    );
}

function validateResume(documentData) {
    const uploadedFile =
        documentData?.trackerrms
            ?.attachDocument?.file;

    if (
        !uploadedFile ||
        typeof uploadedFile.filename !==
            'string' ||
        typeof uploadedFile.data !== 'string'
    ) {
        return {
            valid: false,
            error: 'A résumé is required.',
        };
    }

    const filename = cleanString(
        uploadedFile.filename,
        255
    );

    const data = uploadedFile.data.trim();

    if (
        !/\.(pdf|doc|docx|png|jpg|jpeg)$/i.test(
            filename
        )
    ) {
        return {
            valid: false,
            error:
                'The résumé must be a PDF, DOC, DOCX, PNG, JPG, or JPEG file.',
        };
    }

    if (!data) {
        return {
            valid: false,
            error: 'The résumé file is empty.',
        };
    }

    const decodedSize = Buffer.byteLength(
        data,
        'base64'
    );

    if (
        decodedSize < 1 ||
        decodedSize > MAXIMUM_RESUME_SIZE
    ) {
        return {
            valid: false,
            error:
                'The résumé must be smaller than 10 MB.',
        };
    }

    return {
        valid: true,
        filename,
        data,
    };
}

async function createActivity(activity) {
    const response = await axios.post(
        `${TRACKER_BASE_URL}/createActivity`,
        {
            trackerrms: {
                createActivity: {
                    activity,
                },
            },
        },
        {
            headers: {
                'Content-Type':
                    'application/json',
                Authorization:
                    buildBasicAuthorizationHeader(),
            },
        }
    );

    if (!trackerSucceeded(response.data)) {
        throw new Error(
            response.data?.message ||
                'Tracker could not create the activity.'
        );
    }

    return response.data;
}

app.post(
    '/api/createResource',
    async (req, res) => {
        try {
            if (
                !process.env
                    .TRACKERRMS_USERNAME ||
                !process.env
                    .TRACKERRMS_PASSWORD ||
                !process.env
                    .TRACKERRMS_API_KEY
            ) {
                throw new Error(
                    'Tracker username, password, or API key is not configured.'
                );
            }

            const createResourceRequest =
                req.body?.formData?.trackerrms
                    ?.createResource;

            const documentData =
                req.body?.documentData;

            if (
                !createResourceRequest?.resource
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            'Application information is missing.',
                    });
            }

            const incomingResource =
                createResourceRequest.resource;

            const firstName = cleanString(
                incomingResource.firstname,
                100
            );

            const lastName = cleanString(
                incomingResource.lastname,
                100
            );

            const fullName =
                `${firstName} ${lastName}`.trim();

            const email = cleanString(
                incomingResource.email,
                254
            );

            const cellphone = cleanString(
                incomingResource.cellphone,
                30
            ).replace(/\D/g, '');

            const jobCode = Number(
                createResourceRequest
                    ?.instructions
                    ?.assigntoopportunity
            );

            if (!firstName || !lastName) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            'First name and last name are required.',
                    });
            }

            if (
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                    email
                )
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            'A valid email address is required.',
                    });
            }

            if (cellphone.length !== 10) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            'A valid 10-digit mobile phone number is required.',
                    });
            }

            if (
                !Number.isInteger(jobCode) ||
                jobCode <= 0
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error:
                            'A valid job code was not provided.',
                    });
            }

            const allowedSources = new Set([
                'Website',
                'Google',
                'Dice',
                'Indeed',
                'LinkedIn',
                'CareerBuilder Database Search',
                'Referral',
                'Other',
            ]);

            const requestedSource =
                cleanString(
                    incomingResource.source,
                    100
                );

            const source =
                allowedSources.has(
                    requestedSource
                )
                    ? requestedSource
                    : 'Website';

            const resume =
                validateResume(documentData);

            if (!resume.valid) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        error: resume.error,
                    });
            }

            /*
             * Only send fields that the applicant
             * actually entered.
             *
             * Blank address, employment-history,
             * status, company, and other profile
             * fields are not submitted.
             */
            const safeResource = {
                firstname: firstName,
                lastname: lastName,
                fullname: fullName,
                email,
                cellphone,
                source,
            };

            const linkedin = cleanString(
                incomingResource.linkedin,
                500
            );

            if (
                linkedin &&
                linkedin.toLowerCase() !== 'n/a'
            ) {
                safeResource.linkedin =
                    linkedin;
            }

            /*
             * createResourceFromResume handles:
             *
             * - Candidate matching
             * - Candidate creation
             * - Resume parsing/storage
             * - Job assignment
             * - Applied shortlist placement
             */
            const createFromResumeData = {
                trackerrms: {
                    createResourceFromResume: {
                        credentials:
                            buildResumeCredentials(),

                        instructions: {
                            assigntoopportunity:
                                jobCode,
                            assigntolist:
                                'short',
                            shortlistedby:
                                'resource',
                        },

                        resource:
                            safeResource,

                        file: {
                            filename:
                                resume.filename,
                            data: resume.data,
                        },
                    },
                },
            };

            const resourceResponse =
                await axios.post(
                    `${TRACKER_BASE_URL}/createResourceFromResume`,
                    createFromResumeData,
                    {
                        headers: {
                            'Content-Type':
                                'application/json',
                        },
                    }
                );

            const trackerResult =
                resourceResponse.data;

            const trackerStatus =
                getTrackerStatus(
                    trackerResult
                );

            const recordId =
                getRecordId(trackerResult);

            console.log(
                'Tracker createResourceFromResume response:',
                JSON.stringify(
                    trackerResult,
                    null,
                    2
                )
            );

            const suppliedDateTime =
                createResourceRequest
                    .localDateTime || {};

            const now = new Date();

            const activityDate =
                cleanString(
                    suppliedDateTime.date,
                    20
                ) ||
                now
                    .toISOString()
                    .slice(0, 10);

            const activityTime =
                cleanString(
                    suppliedDateTime.time,
                    20
                ) ||
                now
                    .toISOString()
                    .slice(11, 16);

            const commonActivity = {
                type: 'Email',
                date: activityDate,
                time: activityTime,
                status: 'Completed',
                priority: 'Medium',
                contactType: 'Outbound',
                note:
                    `Website application. Source: ${source}`,
                userId: TRACKER_USER_ID,
            };

            /*
             * Status 3 means Tracker found an
             * existing candidate and protected
             * the record from being overwritten.
             */
            if (
                trackerStatus === 3 &&
                !recordId
            ) {
                const jobActivity =
                    await createActivity({
                        ...commonActivity,
                        subject:
                            `${fullName} has applied.`,
                        linkRecordType: 'O',
                        linkRecordId:
                            jobCode,
                    });

                console.warn(
                    'Tracker protected an existing candidate but returned no record ID:',
                    {
                        fullName,
                        email,
                        jobCode,
                        trackerMessage:
                            trackerResult
                                ?.message ||
                            null,
                    }
                );

                return res
                    .status(200)
                    .json({
                        success: true,
                        submitted: true,
                        existingCandidateProtected:
                            true,
                        candidateRecordId:
                            null,
                        resource:
                            trackerResult,
                        jobActivity,
                    });
            }

            if (
                trackerStatus !== 0 &&
                trackerStatus !== 3
            ) {
                return res
                    .status(502)
                    .json({
                        success: false,
                        error:
                            'Tracker was unable to process the application.',
                        trackerStatus,
                        trackerMessage:
                            trackerResult
                                ?.message ||
                            null,
                    });
            }

            if (!recordId) {
                return res
                    .status(502)
                    .json({
                        success: false,
                        error:
                            'Tracker did not return a candidate record ID.',
                        trackerStatus,
                        trackerMessage:
                            trackerResult
                                ?.message ||
                            null,
                    });
            }

            /*
             * Do not call resourceApplication
             * or attachDocument again.
             *
             * createResourceFromResume has
             * already performed those operations.
             */

            const candidateActivity =
                await createActivity({
                    ...commonActivity,
                    subject:
                        `Filled out application for job ${jobCode}.`,
                    linkRecordType: 'R',
                    linkRecordId:
                        recordId,
                });

            const jobActivity =
                await createActivity({
                    ...commonActivity,
                    subject:
                        `${fullName} has applied.`,
                    linkRecordType: 'O',
                    linkRecordId:
                        jobCode,
                });

            console.log(
                'Website application completed:',
                {
                    fullName,
                    email,
                    jobCode,
                    recordId,
                    source,
                    trackerMessage:
                        trackerResult
                            ?.message ||
                        null,
                    candidateActivityCreated:
                        true,
                    jobActivityCreated:
                        true,
                }
            );

            return res
                .status(200)
                .json({
                    success: true,
                    submitted: true,
                    candidateRecordId:
                        recordId,
                    resource:
                        trackerResult,
                    shortlistHandledBy:
                        'createResourceFromResume',
                    documentHandledBy:
                        'createResourceFromResume',
                    candidateActivity,
                    jobActivity,
                });
        } catch (error) {
            console.error(
                'Application error:',
                {
                    message:
                        error.message,
                    trackerDetails:
                        error.response
                            ?.data ||
                        null,
                    httpStatus:
                        error.response
                            ?.status ||
                        null,
                }
            );

            return res
                .status(500)
                .json({
                    success: false,
                    error:
                        'The application could not be completed.',
                    details:
                        error.response
                            ?.data || {
                            message:
                                error.message,
                        },
                });
        }
    }
);

app.listen(port, () => {
    console.log(
        `Server is running on port ${port}`
    );
});
