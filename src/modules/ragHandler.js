async function getRelevantDocuments(query, collection) {
    try {
        const documents = await chromaClient
            .collection(collection)
            .query({
                queryTexts: [query],
                nResults: 5,
                include: ["metadatas", "documents", "distances"]
            });
        
        if (!documents || !documents.documents.length) {
            console.warn(`No documents found in collection ${collection} for query: ${query}`);
            return [];
        }

        // Group chunks by source document
        const grouped = documents.documents.reduce((acc, doc, index) => {
            const metadata = documents.metadatas[index];
            const sourceFile = metadata?.source || 'unknown';
            
            if (!acc[sourceFile]) {
                acc[sourceFile] = {
                    source: sourceFile,
                    chunks: [],
                    pages: new Set(),
                    metadata: metadata
                };
            }
            
            acc[sourceFile].chunks.push({
                content: doc,
                page: metadata?.page,
                distance: documents.distances?.[index]
            });
            
            if (metadata?.page) {
                acc[sourceFile].pages.add(metadata.page);
            }
            
            return acc;
        }, {});

        // Convert grouped data to final format
        return Object.values(grouped).map(doc => ({
            id: doc.source,
            content: doc.chunks.map(chunk => chunk.content).join('\n\n'),
            metadata: {
                source: doc.source,
                pages: Array.from(doc.pages).sort((a, b) => a - b),
                matchScores: doc.chunks.map(chunk => chunk.distance),
                originalTexts: doc.chunks.map(chunk => chunk.content)
            }
        }));
        
    } catch (error) {
        console.error('ChromaDB query failed:', error);
        throw new Error('Failed to fetch relevant documents');
    }
}

async function getFullDocumentContent(sourcePath, page) {
    const fs = require('fs').promises;
    const path = require('path');
    const { PDFDocument } = require('pdf-lib');

    try {
        // Ensure the source path is valid
        if (!sourcePath) {
            throw new Error('Invalid source path');
        }

        // Read the PDF file
        const pdfBytes = await fs.readFile(sourcePath);
        const pdfDoc = await PDFDocument.load(pdfBytes);

        // If page is specified, get content from that page
        if (page !== undefined && page !== null) {
            const pageObj = pdfDoc.getPage(page - 1); // PDF pages are 0-based
            // Extract text from the specific page
            // Note: You might need a more sophisticated PDF text extraction library
            // like pdf.js or pdfparse for better text extraction
            return pageObj.getText();
        } else {
            // If no page specified, get content from all pages
            let fullContent = '';
            for (let i = 0; i < pdfDoc.getPageCount(); i++) {
                const pageObj = pdfDoc.getPage(i);
                fullContent += await pageObj.getText() + '\n';
            }
            return fullContent;
        }
    } catch (error) {
        console.error(`Error reading document ${sourcePath}:`, error);
        throw new Error(`Failed to read document content: ${error.message}`);
    }
}

async function processRagResponse(query, persona) {
    try {
        const resolvedPersona = await Promise.resolve(persona);
        
        if (!resolvedPersona) {
            throw new Error('No persona provided');
        }

        const documents = await getRelevantDocuments(query, 'your_collection_name');
        
        if (!documents.length) {
            return {
                text: "I couldn't find relevant information to answer your question.",
                source_documents: [],
                personaUsed: resolvedPersona
            };
        }

        // Prepare context with grouped content
        const context = documents.map(doc => {
            return `
                Source: ${path.basename(doc.metadata.source)}
                Pages: ${doc.metadata.pages.join(', ')}
                Content:
                ${doc.content}
            `.trim();
        }).join('\n\n---\n\n');
        
        const llmResponse = await llmModule.generateResponse({
            persona: resolvedPersona,
            query: query,
            context: context
        });

        return {
            text: llmResponse,
            source_documents: documents,
            personaUsed: resolvedPersona
        };
    } catch (error) {
        console.error('RAG processing failed:', error);
        throw error;
    }
} 