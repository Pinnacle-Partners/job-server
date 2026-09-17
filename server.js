const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({
    limit: '20mb',
    extended: true,
}));

app.post('/api/createResource', async (req, res) => {
    try {
        const { formData, documentData } = req.body;

        const createResourceRequest =
            formData?.trackerrms?.createResource;

        if (!createResourceRequest) {
            return res.status(400).json({
                success: false,
                error: 'Application information is missing.',
            });
        }

        const resource = createResourceRequest.resource;

        if (!resource) {
            return res.status(400).json({
                success: false,
                error: 'Candidate information is missing.',
            });
        }

        /*
         * Read and validate the job code.
         */
        const jobCode = Number(
            createResourceRequest?.instructions
                ?.assigntoopportunity
        );

        if (
            !Number.isInteger(jobCode) ||
            jobCode <= 0
        ) {
            return res.status(400).json({
                success: false,
                error: 'A valid job code was not provided.',
            });
        }

        /*
         * Validate the applicant's basic information.
         */
        const firstName =
            typeof resource.firstname === 'string'
                ? resource.firstname.trim()
                : '';

        const lastName =
            typeof resource.lastname === 'string'
                ? resource.lastname.trim()
                : '';

        const email =
            typeof resource.email === 'string'
                ? resource.email.trim()
                : '';

        const cellphone =
            typeof resource.cellphone === 'string'
                ? resource.cellphone.replace(/\D/g, '')
                : '';

        if (!firstName || !lastName) {
            return res.status(400).json({
                success: false,
                error: 'First name and last name are required.',
            });
        }

        if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            return res.status(400).json({
                success: false,
                error: 'A valid email address is required.',
            });
        }

        if (cellphone.length !== 10) {
            return res.status(400).json({
                success: false,
                error: 'A valid 10-digit phone number is required.',
            });
        }

        /*
         * Always force overwrite protection on the server.
         *
         * A person cannot change this to true by manipulating
         * the browser request.
         */
        createResourceRequest.instructions = {
            overwriteresource: false,
            assigntoopportunity: jobCode,
            assigntolist: 'short',
            shortlistedby: 'resource',
        };

        /*
         * Add Tracker credentials on the server.
         */
        createResourceRequest.credentials = {
            username:
                process.env.TRACKERRMS_USERNAME,
            password:
                process.env.TRACKERRMS_PASSWORD,
        };

        /*
         * Attempt to create the candidate.
         *
         * New candidates should also be added to the Applied
         * shortlist through the instructions above.
         */
        const resourceResponse = await axios.post(
            'https://evoapius.tracker-rms.com/api/widget/createResource',
            formData,
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        const trackerResult = resourceResponse.data;
        const trackerStatus = Number(
            trackerResult?.status
        );

        let recordId = trackerResult?.recordId;
        let resourceApplicationResult = null;

        console.log('Tracker createResource response:', {
            status: trackerStatus,
            message: trackerResult?.message,
            recordId: recordId || null,
            jobCode,
            email,
        });

        /*
         * Do not continue without a record ID.
         */
        if (!recordId) {
            return res.status(502).json({
                success: false,
                error:
                    'Tracker did not return a candidate record ID.',
                trackerStatus,
                trackerMessage:
                    trackerResult?.message || null,
            });
        }

        /*
         * Status 3 means Tracker found an existing candidate
         * and refused to overwrite the candidate.
         *
         * Use the existing record ID only to add that candidate
         * to the new job's Applied shortlist.
         */
        if (trackerStatus === 3) {
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
                            assigntolist: 'short',
                            shortlistedby: 'resource',
                            source: 'Website',
                        },
                    },
                },
            };

            const resourceApplicationResponse =
                await axios.post(
                    'https://evoapius.tracker-rms.com/api/widget/resourceApplication',
                    resourceApplicationData,
                    {
                        headers: {
                            'Content-Type':
                                'application/json',
                        },
                    }
                );

            resourceApplicationResult =
                resourceApplicationResponse.data;

            console.log(
                'Tracker resourceApplication response:',
                {
                    response:
                        resourceApplicationResult,
                    recordId,
                    jobCode,
                }
            );

            /*
             * Tracker may return an HTTP 200 even when its
             * internal status indicates failure.
             */
            if (
                resourceApplicationResult?.status !==
                    undefined &&
                Number(
                    resourceApplicationResult.status
                ) !== 0
            ) {
                return res.status(502).json({
                    success: false,
                    error:
                        'Tracker found the candidate but could not add them to the job.',
                    trackerStatus:
                        resourceApplicationResult.status,
                    trackerMessage:
                        resourceApplicationResult
                            .message || null,
                });
            }
        }

        /*
         * Status 0 means Tracker successfully created the
         * candidate.
         */
        else if (trackerStatus === 0) {
            /*
             * This should not happen because overwrite is false.
             * Stop if Tracker says it updated an existing record.
             */
            if (
                typeof trackerResult?.message ===
                    'string' &&
                trackerResult.message
                    .toLowerCase()
                    .includes('updated')
            ) {
                console.error(
                    'Unexpected candidate update:',
                    {
                        trackerResult,
                        recordId,
                        jobCode,
                        email,
                    }
                );

                return res.status(409).json({
                    success: false,
                    error:
                        'Tracker reported an unexpected candidate update. Processing stopped.',
                });
            }
        }

        /*
         * Stop for all other Tracker statuses.
         */
        else {
            return res.status(502).json({
                success: false,
                error:
                    'Tracker was unable to process the candidate.',
                trackerStatus,
                trackerMessage:
                    trackerResult?.message || null,
            });
        }

        /*
         * At this point:
         *
         * - A new candidate was created and assigned, or
         * - An existing candidate was added to the new job.
         *
         * The profile itself was not overwritten.
         */
        const fullName =
            `${firstName} ${lastName}`;

        const submittedDateTime =
            createResourceRequest.localDateTime || {};

        const currentDate = new Date();

        const activityDate =
            submittedDateTime.date ||
            currentDate.toISOString().slice(0, 10);

        const activityTime =
            submittedDateTime.time ||
            currentDate.toISOString().slice(11, 16);

        const authHeader =
            'Basic ' +
            Buffer.from(
                `${process.env.TRACKERRMS_USERNAME}:${process.env.TRACKERRMS_PASSWORD}`
            ).toString('base64');

        /*
         * Create the candidate-profile activity.
         */
        const candidateActivityData = {
            trackerrms: {
                createActivity: {
                    activity: {
                        subject:
                            `Filled out application for job ${jobCode}.`,
                        type: 'Email',
                        date: activityDate,
                        time: activityTime,
                        status: 'Completed',
                        priority: 'Medium',
                        contactType: 'Outbound',
                        note:
                            'Associated with website application',
                        linkRecordType: 'R',
                        linkRecordId: recordId,
                        userId: 3714,
                    },
                },
            },
        };

        const candidateActivityResponse =
            await axios.post(
                'https://evoapius.tracker-rms.com/api/widget/createActivity',
                candidateActivityData,
                {
                    headers: {
                        'Content-Type':
                            'application/json',
                        Authorization: authHeader,
                    },
                }
            );

        if (
            candidateActivityResponse.data?.status !==
                undefined &&
            Number(
                candidateActivityResponse.data.status
            ) !== 0
        ) {
            throw new Error(
                candidateActivityResponse.data.message ||
                'The candidate activity could not be created.'
            );
        }

        /*
         * Create the job/opportunity activity.
         */
        const opportunityActivityData = {
            trackerrms: {
                createActivity: {
                    activity: {
                        subject:
                            `${fullName} has applied.`,
                        type: 'Email',
                        date: activityDate,
                        time: activityTime,
                        status: 'Completed',
                        priority: 'Medium',
                        contactType: 'Outbound',
                        note:
                            'Associated with website application',
                        linkRecordType: 'O',
                        linkRecordId: jobCode,
                        userId: 3714,
                    },
                },
            },
        };

        const opportunityActivityResponse =
            await axios.post(
                'https://evoapius.tracker-rms.com/api/widget/createActivity',
                opportunityActivityData,
                {
                    headers: {
                        'Content-Type':
                            'application/json',
                        Authorization: authHeader,
                    },
                }
            );

        if (
            opportunityActivityResponse.data?.status !==
                undefined &&
            Number(
                opportunityActivityResponse.data.status
            ) !== 0
        ) {
            throw new Error(
                opportunityActivityResponse.data.message ||
                'The opportunity activity could not be created.'
            );
        }

        /*
         * Attach the submitted résumé.
         *
         * This adds a document to the candidate. It does not
         * change or overwrite the candidate's profile fields.
         */
        let documentResponse = null;

        if (documentData) {
            const attachDocumentRequest =
                documentData?.trackerrms
                    ?.attachDocument;

            const uploadedFile =
                attachDocumentRequest?.file;

            if (
                !attachDocumentRequest ||
                !uploadedFile ||
                typeof uploadedFile.filename !==
                    'string' ||
                typeof uploadedFile.data !== 'string'
            ) {
                throw new Error(
                    'The résumé information is invalid.'
                );
            }

            if (
                !/\.(pdf|doc|docx|png|jpg|jpeg)$/i.test(
                    uploadedFile.filename
                )
            ) {
                throw new Error(
                    'The résumé must be a PDF, DOC, DOCX, PNG, JPG, or JPEG file.'
                );
            }

            const fileSize = Buffer.byteLength(
                uploadedFile.data,
                'base64'
            );

            const maximumFileSize =
                10 * 1024 * 1024;

            if (
                fileSize < 1 ||
                fileSize > maximumFileSize
            ) {
                throw new Error(
                    'The résumé must be smaller than 10 MB.'
                );
            }

            /*
             * Set the Tracker credentials and confirmed
             * candidate record ID on the server.
             */
            attachDocumentRequest.credentials = {
                username:
                    process.env.TRACKERRMS_USERNAME,
                password:
                    process.env.TRACKERRMS_PASSWORD,
            };

            attachDocumentRequest.file.recordId =
                recordId;

            attachDocumentRequest.file.recordType =
                'R';

            attachDocumentRequest.file.documentType =
                'resume';

            attachDocumentRequest.file.primary = 'R';

            documentResponse = await axios.post(
                'https://evoapius.tracker-rms.com/api/widget/attachDocument',
                documentData,
                {
                    headers: {
                        'Content-Type':
                            'application/json',
                    },
                }
            );

            if (
                documentResponse.data?.status !==
                    undefined &&
                Number(
                    documentResponse.data.status
                ) !== 0
            ) {
                throw new Error(
                    documentResponse.data.message ||
                    'The résumé could not be attached.'
                );
            }
        }

        console.log('Application completed:', {
            recordId,
            trackerStatus,
            jobCode,
            email,
            existingCandidate:
                trackerStatus === 3,
        });

        return res.status(200).json({
            success: true,
            resource: trackerResult,
            resourceApplication:
                resourceApplicationResult,
            activity1:
                candidateActivityResponse.data,
            activity2:
                opportunityActivityResponse.data,
            document: documentResponse
                ? documentResponse.data
                : null,
        });
    } catch (error) {
        console.error('Application error:', {
            message: error.message,
            trackerDetails:
                error.response?.data || null,
            httpStatus:
                error.response?.status || null,
        });

        return res.status(500).json({
            success: false,
            error:
                'The application could not be completed.',
            details:
                error.response?.data ||
                { message: error.message },
        });
    }
});

app.listen(port, () => {
    console.log(
        `Server is running on port ${port}`
    );
});
