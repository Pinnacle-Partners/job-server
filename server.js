const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const axios = require('axios');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

app.use(
    express.json({
        limit: '20mb',
    })
);

app.use(
    express.urlencoded({
        limit: '20mb',
        extended: true,
    })
);

function trackerResponseFailed(responseData) {
    return (
        responseData?.status !== undefined &&
        Number(responseData.status) !== 0
    );
}

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

        const resource =
            createResourceRequest.resource;

        if (!resource) {
            return res.status(400).json({
                success: false,
                error: 'Candidate information is missing.',
            });
        }

        /*
         * Validate the job code.
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
         * Read the candidate information.
         */
        const firstName =
            typeof resource.firstname === 'string'
                ? resource.firstname.trim()
                : '';

        const lastName =
            typeof resource.lastname === 'string'
                ? resource.lastname.trim()
                : '';

        const fullName =
            `${firstName} ${lastName}`.trim();

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
         * Force safe instructions on the server.
         *
         * This prevents the browser or applicant from enabling
         * overwriting.
         */
        createResourceRequest.instructions = {
            overwriteresource: false,
            assigntoopportunity: jobCode,
            assigntolist: 'short',
            shortlistedby: 'resource',
        };

        /*
         * Tracker credentials are added only on the server.
         */
        createResourceRequest.credentials = {
            username:
                process.env.TRACKERRMS_USERNAME,
            password:
                process.env.TRACKERRMS_PASSWORD,
        };

        /*
         * Create or locate the resource and add it to Applied.
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

        const trackerResult =
            resourceResponse.data;

        const trackerStatus = Number(
            trackerResult?.status
        );

        /*
         * Log every property returned by Tracker.
         */
        console.log(
            'COMPLETE TRACKER RESPONSE:',
            JSON.stringify(trackerResult, null, 2)
        );

        /*
         * Accept:
         *
         * Status 0 = candidate created successfully.
         * Status 3 = existing candidate found and not overwritten.
         *
         * The assignment to Applied is included in the original
         * createResource request.
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
                    trackerResult?.message || null,
            });
        }

        /*
         * Extra safety check.
         *
         * Tracker should never say "updated" because overwrite
         * protection is false.
         */
        if (
            typeof trackerResult?.message === 'string' &&
            trackerResult.message
                .toLowerCase()
                .includes('updated')
        ) {
            console.error(
                'Tracker unexpectedly updated a resource:',
                JSON.stringify(trackerResult, null, 2)
            );

            return res.status(409).json({
                success: false,
                error:
                    'Tracker reported an unexpected candidate update. Processing stopped.',
            });
        }

        /*
         * Tracker may return the candidate ID under a different
         * property name.
         */
        const recordId =
            trackerResult?.recordId ||
            trackerResult?.recordid ||
            trackerResult?.resourceId ||
            trackerResult?.resourceid ||
            trackerResult?.ResourceId ||
            trackerResult?.ResourceID ||
            trackerResult?.id ||
            trackerResult?.Id ||
            null;

        console.log('Resolved candidate record ID:', {
            recordId,
            trackerStatus,
            jobCode,
            fullName,
            email,
        });

        /*
         * Use the applicant's local date and time when available.
         */
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
         * Create the job activity first.
         *
         * This activity does not require the candidate record ID.
         */
        const jobActivityData = {
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

        const jobActivityResponse =
            await axios.post(
                'https://evoapius.tracker-rms.com/api/widget/createActivity',
                jobActivityData,
                {
                    headers: {
                        'Content-Type':
                            'application/json',
                        Authorization: authHeader,
                    },
                }
            );

        if (
            trackerResponseFailed(
                jobActivityResponse.data
            )
        ) {
            throw new Error(
                jobActivityResponse.data.message ||
                'The job activity could not be created.'
            );
        }

        console.log('Job activity created:', {
            jobCode,
            fullName,
            response: jobActivityResponse.data,
        });

        /*
         * The candidate-profile activity requires a candidate
         * record ID.
         */
        let candidateActivityResponse = null;

        if (recordId) {
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

            candidateActivityResponse =
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
                trackerResponseFailed(
                    candidateActivityResponse.data
                )
            ) {
                throw new Error(
                    candidateActivityResponse.data
                        .message ||
                    'The candidate activity could not be created.'
                );
            }

            console.log(
                'Candidate activity created:',
                {
                    recordId,
                    jobCode,
                    response:
                        candidateActivityResponse.data,
                }
            );
        } else {
            console.warn(
                'Candidate activity skipped because Tracker did not return a candidate record ID:',
                {
                    trackerStatus,
                    jobCode,
                    fullName,
                    email,
                }
            );
        }

        /*
         * Attach the résumé only when Tracker returns a confirmed
         * candidate record ID.
         */
        let documentResponse = null;

        if (documentData && recordId) {
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
                trackerResponseFailed(
                    documentResponse.data
                )
            ) {
                throw new Error(
                    documentResponse.data.message ||
                    'The résumé could not be attached.'
                );
            }

            console.log('Résumé attached:', {
                recordId,
                filename: uploadedFile.filename,
                response: documentResponse.data,
            });
        } else if (documentData && !recordId) {
            console.warn(
                'Résumé attachment skipped because Tracker did not return a candidate record ID:',
                {
                    trackerStatus,
                    jobCode,
                    fullName,
                    email,
                }
            );
        }

        console.log('Application completed:', {
            trackerStatus,
            recordId,
            jobCode,
            fullName,
            email,
            jobActivityCreated: true,
            candidateActivityCreated:
                Boolean(candidateActivityResponse),
            documentAttached:
                Boolean(documentResponse),
        });

        /*
         * Return success to the website.
         *
         * The applicant receives the normal success toast.
         */
        return res.status(200).json({
            success: true,
            submitted: true,
            resource: trackerResult,
            jobActivity: jobActivityResponse.data,
            candidateActivity:
                candidateActivityResponse
                    ? candidateActivityResponse.data
                    : null,
            document: documentResponse
                ? documentResponse.data
                : null,
            candidateRecordId:
                recordId || null,
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
