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

function buildTrackerCredentials() {
    return {
        username: process.env.TRACKERRMS_USERNAME,
        password: process.env.TRACKERRMS_PASSWORD,
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

function sanitizeJobHistory(jobHistory) {
    if (!Array.isArray(jobHistory)) {
        return [];
    }

    return jobHistory.slice(0, 2).map((job) => ({
        company: cleanString(job?.company, 150),
        jobtitle: cleanString(job?.jobtitle, 150),
        startdate: cleanString(job?.startdate, 25),
        enddate: cleanString(job?.enddate, 25),
        description: cleanString(
            job?.description,
            2000
        ),
    }));
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
                'Content-Type': 'application/json',
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

app.post('/api/createResource', async (req, res) => {
    try {
        if (
            !process.env.TRACKERRMS_USERNAME ||
            !process.env.TRACKERRMS_PASSWORD
        ) {
            throw new Error(
                'Tracker credentials are not configured.'
            );
        }

        const createResourceRequest =
            req.body?.formData?.trackerrms
                ?.createResource;

        const documentData =
            req.body?.documentData;

        if (!createResourceRequest?.resource) {
            return res.status(400).json({
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
            createResourceRequest?.instructions
                ?.assigntoopportunity
        );

        if (!firstName || !lastName) {
            return res.status(400).json({
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
            return res.status(400).json({
                success: false,
                error:
                    'A valid email address is required.',
            });
        }

        if (cellphone.length !== 10) {
            return res.status(400).json({
                success: false,
                error:
                    'A valid 10-digit mobile phone number is required.',
            });
        }

        if (
            !Number.isInteger(jobCode) ||
            jobCode <= 0
        ) {
            return res.status(400).json({
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

        const requestedSource = cleanString(
            incomingResource.source,
            100
        );

        const source = allowedSources.has(
            requestedSource
        )
            ? requestedSource
            : 'Website';

        const linkedinValue = cleanString(
            incomingResource.linkedin,
            500
        );

        /*
         * Only these permitted candidate fields are
         * forwarded to Tracker.
         */
        const safeResource = {
            firstname: firstName,
            lastname: lastName,
            fullname: fullName,

            jobtitle: cleanString(
                incomingResource.jobtitle,
                150
            ),

            company: cleanString(
                incomingResource.company,
                150
            ),

            address1: cleanString(
                incomingResource.address1,
                200
            ),

            address2: cleanString(
                incomingResource.address2,
                200
            ),

            city: cleanString(
                incomingResource.city,
                100
            ),

            state: cleanString(
                incomingResource.state,
                100
            ),

            zipcode: cleanString(
                incomingResource.zipcode,
                25
            ),

            country: cleanString(
                incomingResource.country,
                100
            ),

            workphone: cleanString(
                incomingResource.workphone,
                30
            ),

            homephone: cleanString(
                incomingResource.homephone,
                30
            ),

            cellphone,
            email,

            /*
             * Never send "N/A" as a LinkedIn URL.
             */
            linkedin:
                linkedinValue.toLowerCase() ===
                'n/a'
                    ? ''
                    : linkedinValue,

            dateofbirth: cleanString(
                incomingResource.dateofbirth,
                25
            ),

            nationality: cleanString(
                incomingResource.nationality,
                100
            ),

            languages: cleanString(
                incomingResource.languages,
                250
            ),

            education: cleanString(
                incomingResource.education,
                250
            ),

            source,

            jobhistory: sanitizeJobHistory(
                incomingResource.jobhistory
            ),

            salary: cleanString(
                incomingResource.salary,
                50
            ),

            note: cleanString(
                incomingResource.note,
                4000
            ),

            image: cleanString(
                incomingResource.image,
                1000
            ),

            skills: cleanString(
                incomingResource.skills,
                1000
            ),

            status: cleanString(
                incomingResource.status,
                100
            ),
        };

        /*
         * The browser is never allowed to control
         * the overwrite setting.
         *
         * The candidate is assigned to the job later
         * through resourceApplication, preventing a
         * duplicate assignment.
         */
        const safeCreateResourceData = {
            trackerrms: {
                createResource: {
                    credentials:
                        buildTrackerCredentials(),

                    instructions: {
                        overwriteresource: true,
                    },

                    resource: safeResource,
                },
            },
        };

        const resourceResponse =
            await axios.post(
                `${TRACKER_BASE_URL}/createResource`,
                safeCreateResourceData,
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
            getTrackerStatus(trackerResult);

        const recordId =
            getRecordId(trackerResult);

        console.log(
            'Tracker createResource response:',
            JSON.stringify(
                trackerResult,
                null,
                2
            )
        );

        /*
         * Use the applicant's local date and time
         * supplied by the frontend.
         */
        const suppliedDateTime =
            createResourceRequest.localDateTime ||
            {};

        const now = new Date();

        const activityDate =
            cleanString(
                suppliedDateTime.date,
                20
            ) ||
            now.toISOString().slice(0, 10);

        const activityTime =
            cleanString(
                suppliedDateTime.time,
                20
            ) ||
            now.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            });

        const commonActivity = {
            type: 'Email',
            date: activityDate,
            time: activityTime,
            status: 'Completed',
            priority: 'Medium',
            contactType: 'Outbound',

            note:
                `Website application. ` +
                `Source: ${source}`,

            userId: TRACKER_USER_ID,
        };

        /*
         * Status 3 means Tracker found an existing
         * candidate and refused to overwrite that
         * person's profile fields.
         *
         * If Tracker supplies the existing record ID,
         * processing continues safely.
         *
         * If Tracker does not supply a record ID,
         * do not guess which candidate should receive
         * the activity or résumé.
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
                    linkRecordId: jobCode,
                });

            console.warn(
                'Existing candidate found, but Tracker returned no record ID:',
                {
                    fullName,
                    email,
                    jobCode,

                    trackerMessage:
                        trackerResult?.message ||
                        null,
                }
            );

            /*
             * The applicant still receives the normal
             * success confirmation.
             *
             * The existing candidate is not modified
             * because Tracker did not confirm an ID.
             */
            return res.status(200).json({
                success: true,
                submitted: true,

                existingCandidateProtected:
                    true,

                candidateUpdated: false,
                candidateRecordId: null,

                resource: trackerResult,
                jobActivity,
            });
        }

        /*
         * Allow:
         *
         * Status 0 — new candidate created.
         * Status 3 — existing candidate found with
         * a confirmed record ID.
         */
        if (
            trackerStatus !== 0 &&
            trackerStatus !== 3
        ) {
            return res.status(502).json({
                success: false,

                error:
                    'Tracker was unable to process the candidate.',

                trackerStatus,

                trackerMessage:
                    trackerResult?.message ||
                    null,
            });
        }

        if (
            trackerStatus === 0 &&
            !recordId
        ) {
            return res.status(502).json({
                success: false,

                error:
                    'Tracker did not return a candidate record ID.',
            });
        }

        /*
         * Tracker should not update candidate profile
         * fields when overwrite protection is false.
         */
        if (
            trackerStatus === 0 &&
            typeof trackerResult?.message ===
                'string' &&
            trackerResult.message
                .toLowerCase()
                .includes('updated')
        ) {
            return res.status(409).json({
                success: false,

                error:
                    'Tracker unexpectedly reported that a candidate profile was updated.',
            });
        }

        /*
         * Add the new or confirmed existing candidate
         * to the job's Applied shortlist.
         */
        const resourceApplicationData = {
            trackerrms: {
                resourceApplication: {
                    credentials:
                        buildTrackerCredentials(),

                    instructions: {
                        opportunityid: jobCode,
                        resourceid: recordId,
                        assigntolist: 'short',
                        shortlistedby: 'resource',
                        source,
                    },
                },
            },
        };

        const resourceApplicationResponse =
            await axios.post(
                `${TRACKER_BASE_URL}/resourceApplication`,
                resourceApplicationData,
                {
                    headers: {
                        'Content-Type':
                            'application/json',
                    },
                }
            );

        if (
            !trackerSucceeded(
                resourceApplicationResponse.data
            )
        ) {
            throw new Error(
                resourceApplicationResponse
                    .data?.message ||
                    'Tracker could not add the candidate to the Applied shortlist.'
            );
        }

        /*
         * Add the application activity to the
         * candidate's profile.
         */
        const candidateActivity =
            await createActivity({
                ...commonActivity,

                subject:
                    `Filled out application for job ${jobCode}.`,

                linkRecordType: 'R',
                linkRecordId: recordId,
            });

        /*
         * Add the application activity to the job.
         */
        const jobActivity =
            await createActivity({
                ...commonActivity,

                subject:
                    `${fullName} has applied.`,

                linkRecordType: 'O',
                linkRecordId: jobCode,
            });

        /*
         * Attach the submitted résumé to the candidate.
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
                typeof uploadedFile.data !==
                    'string'
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

            const decodedSize =
                Buffer.byteLength(
                    uploadedFile.data,
                    'base64'
                );

            const maximumFileSize =
                10 * 1024 * 1024;

            if (
                decodedSize < 1 ||
                decodedSize >
                    maximumFileSize
            ) {
                throw new Error(
                    'The résumé must be smaller than 10 MB.'
                );
            }

            const safeDocumentData = {
                trackerrms: {
                    attachDocument: {
                        credentials:
                            buildTrackerCredentials(),

                        file: {
                            filename:
                                cleanString(
                                    uploadedFile.filename,
                                    255
                                ),

                            recordType: 'R',
                            recordId,
                            documentType: 'resume',

                            /*
                             * This tells Tracker the
                             * uploaded document is a résumé.
                             * Existing documents are not
                             * deleted by this code.
                             */
                            primary: 'R',

                            data:
                                uploadedFile.data,
                        },
                    },
                },
            };

            const documentApiResponse =
                await axios.post(
                    `${TRACKER_BASE_URL}/attachDocument`,
                    safeDocumentData,
                    {
                        headers: {
                            'Content-Type':
                                'application/json',
                        },
                    }
                );

            if (
                !trackerSucceeded(
                    documentApiResponse.data
                )
            ) {
                throw new Error(
                    documentApiResponse.data
                        ?.message ||
                        'Tracker could not attach the résumé.'
                );
            }

            documentResponse =
                documentApiResponse.data;
        }

        console.log(
            'Website application completed:',
            {
                fullName,
                email,
                jobCode,
                recordId,
                source,

                existingCandidate:
                    trackerStatus === 3,

                documentAttached:
                    Boolean(
                        documentResponse
                    ),
            }
        );

        return res.status(200).json({
            success: true,
            submitted: true,

            existingCandidateMatched:
                trackerStatus === 3,

            profileFieldsOverwritten:
                false,

            candidateRecordId:
                recordId,

            resource:
                trackerResult,

            resourceApplication:
                resourceApplicationResponse.data,

            candidateActivity,
            jobActivity,

            document:
                documentResponse,
        });
    } catch (error) {
        console.error(
            'Application error:',
            {
                message:
                    error.message,

                trackerDetails:
                    error.response?.data ||
                    null,

                httpStatus:
                    error.response?.status ||
                    null,
            }
        );

        return res.status(500).json({
            success: false,

            error:
                'The application could not be completed.',

            details:
                error.response?.data || {
                    message:
                        error.message,
                },
        });
    }
});

app.listen(port, () => {
    console.log(
        `Server is running on port ${port}`
    );
});
